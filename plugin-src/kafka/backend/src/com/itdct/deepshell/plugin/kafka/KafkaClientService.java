package com.itdct.deepshell.plugin.kafka;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.Config;
import org.apache.kafka.clients.admin.ConfigEntry;
import org.apache.kafka.clients.admin.ConsumerGroupDescription;
import org.apache.kafka.clients.admin.ConsumerGroupListing;
import org.apache.kafka.clients.admin.DescribeClusterResult;
import org.apache.kafka.clients.admin.ListOffsetsResult;
import org.apache.kafka.clients.admin.MemberDescription;
import org.apache.kafka.clients.admin.NewPartitions;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.clients.admin.TopicDescription;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.Node;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.config.ConfigResource;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka 连接与会话管理。
 *
 * <p>每个 {@code connectionId} 对应一个 AdminClient + 延迟创建的 Producer / Consumer。
 * 浏览消息使用独立的消费组且不提交位点，不会影响业务消费组。</p>
 */
final class KafkaClientService {

    private static final int MAX_FETCH = 500;
    private static final int MESSAGE_TEXT_LIMIT = 64 * 1024;
    private static final int MAX_SESSIONS = 8;
    private static final long IDLE_TIMEOUT_MS = 30L * 60 * 1000;

    private final Map<String, Session> sessions = new ConcurrentHashMap<String, Session>();

    Map<String, Object> connect(String servers, String securityProtocol, String saslMechanism,
                                String username, String password, String clientId, int timeoutMs)
            throws Exception {
        final Properties props = baseProps(servers, securityProtocol, saslMechanism, username,
                password, clientId, timeoutMs);
        final AdminClient admin = AdminClient.create(props);
        final long timeout = timeoutMs;
        try {
            DescribeClusterResult cluster = admin.describeCluster();
            Collection<Node> nodes = cluster.nodes().get(timeout, TimeUnit.MILLISECONDS);
            Node controller = cluster.controller().get(timeout, TimeUnit.MILLISECONDS);
            String clusterId = cluster.clusterId().get(timeout, TimeUnit.MILLISECONDS);
            int topicCount = admin.listTopics().names().get(timeout, TimeUnit.MILLISECONDS).size();

            final Session session = new Session(admin, props, timeout);
            final String connectionId = UUID.randomUUID().toString().replace("-", "");
            sessions.put(connectionId, session);
            trimSessions();

            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("connectionId", connectionId);
            out.put("clusterId", clusterId == null ? "" : clusterId);
            out.put("servers", servers);
            out.put("controller", controller == null ? -1 : controller.id());
            out.put("topicCount", topicCount);
            List<Map<String, Object>> brokers = new ArrayList<Map<String, Object>>();
            for (Node node : nodes) {
                brokers.add(node(node, controller != null && node.id() == controller.id()));
            }
            brokers.sort(new Comparator<Map<String, Object>>() {
                @Override
                public int compare(Map<String, Object> a, Map<String, Object> b) {
                    return Integer.compare(((Number) a.get("id")).intValue(),
                            ((Number) b.get("id")).intValue());
                }
            });
            out.put("brokers", brokers);
            return out;
        } catch (Exception e) {
            try {
                admin.close(Duration.ofMillis(1500));
            } catch (Exception ignore) {
                // ignore
            }
            throw new IllegalArgumentException(friendly(e));
        }
    }

    void disconnect(String connectionId) {
        Session session = sessions.remove(connectionId);
        if (session != null) {
            session.close();
        }
    }

    void shutdown() {
        for (Session session : sessions.values()) {
            session.close();
        }
        sessions.clear();
    }

    Map<String, Object> overview(String connectionId) throws Exception {
        Session s = session(connectionId);
        DescribeClusterResult cluster = s.admin.describeCluster();
        Collection<Node> nodes = cluster.nodes().get(s.timeout, TimeUnit.MILLISECONDS);
        Node controller = cluster.controller().get(s.timeout, TimeUnit.MILLISECONDS);
        String clusterId = cluster.clusterId().get(s.timeout, TimeUnit.MILLISECONDS);
        Collection<String> topicNames = s.admin.listTopics().names().get(s.timeout, TimeUnit.MILLISECONDS);
        Map<String, TopicDescription> descs = s.admin.describeTopics(topicNames).all()
                .get(s.timeout, TimeUnit.MILLISECONDS);
        int partitions = 0;
        for (TopicDescription desc : descs.values()) {
            partitions += desc.partitions().size();
        }
        Collection<ConsumerGroupListing> groups = s.admin.listConsumerGroups().all()
                .get(s.timeout, TimeUnit.MILLISECONDS);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("clusterId", clusterId == null ? "" : clusterId);
        out.put("controller", controller == null ? -1 : controller.id());
        out.put("topicCount", topicNames.size());
        out.put("partitionCount", partitions);
        out.put("groupCount", groups.size());
        List<Map<String, Object>> brokers = new ArrayList<Map<String, Object>>();
        for (Node node : nodes) {
            brokers.add(node(node, controller != null && node.id() == controller.id()));
        }
        brokers.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return Integer.compare(((Number) a.get("id")).intValue(),
                        ((Number) b.get("id")).intValue());
            }
        });
        out.put("brokers", brokers);
        return out;
    }

    List<Map<String, Object>> topics(String connectionId) throws Exception {
        Session s = session(connectionId);
        Collection<String> names = s.admin.listTopics().names().get(s.timeout, TimeUnit.MILLISECONDS);
        if (names.isEmpty()) {
            return new ArrayList<Map<String, Object>>();
        }
        Map<String, TopicDescription> descs = s.admin.describeTopics(names).all()
                .get(s.timeout, TimeUnit.MILLISECONDS);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (TopicDescription desc : descs.values()) {
            int underReplicated = 0;
            int replication = 0;
            for (org.apache.kafka.common.TopicPartitionInfo p : desc.partitions()) {
                if (p.isr().size() < p.replicas().size()) {
                    underReplicated++;
                }
                replication = Math.max(replication, p.replicas().size());
            }
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("name", desc.name());
            item.put("internal", desc.isInternal());
            item.put("partitions", desc.partitions().size());
            item.put("replication", replication);
            item.put("underReplicated", underReplicated);
            out.add(item);
        }
        out.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                boolean ai = Boolean.TRUE.equals(a.get("internal"));
                boolean bi = Boolean.TRUE.equals(b.get("internal"));
                if (ai != bi) {
                    return ai ? 1 : -1;
                }
                return String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name")));
            }
        });
        return out;
    }

    Map<String, Object> describeTopic(String connectionId, String topic) throws Exception {
        Session s = session(connectionId);
        TopicDescription desc = s.admin.describeTopics(Collections.singletonList(topic))
                .all().get(s.timeout, TimeUnit.MILLISECONDS).get(topic);
        if (desc == null) {
            throw new IllegalArgumentException("主题不存在: " + topic);
        }
        List<TopicPartition> tps = new ArrayList<TopicPartition>();
        for (org.apache.kafka.common.TopicPartitionInfo p : desc.partitions()) {
            tps.add(new TopicPartition(topic, p.partition()));
        }
        Map<TopicPartition, OffsetSpec> earliestReq = new HashMap<TopicPartition, OffsetSpec>();
        Map<TopicPartition, OffsetSpec> latestReq = new HashMap<TopicPartition, OffsetSpec>();
        for (TopicPartition tp : tps) {
            earliestReq.put(tp, OffsetSpec.earliest());
            latestReq.put(tp, OffsetSpec.latest());
        }
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> earliest =
                s.admin.listOffsets(earliestReq).all().get(s.timeout, TimeUnit.MILLISECONDS);
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> latest =
                s.admin.listOffsets(latestReq).all().get(s.timeout, TimeUnit.MILLISECONDS);

        List<Map<String, Object>> partitions = new ArrayList<Map<String, Object>>();
        long total = 0;
        for (org.apache.kafka.common.TopicPartitionInfo p : desc.partitions()) {
            TopicPartition tp = new TopicPartition(topic, p.partition());
            long begin = offset(earliest.get(tp));
            long end = offset(latest.get(tp));
            long count = Math.max(0, end - begin);
            total += count;
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", p.partition());
            item.put("leader", p.leader() == null ? -1 : p.leader().id());
            item.put("replicas", ids(p.replicas()));
            item.put("isr", ids(p.isr()));
            item.put("beginningOffset", begin);
            item.put("endOffset", end);
            item.put("count", count);
            partitions.add(item);
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("name", desc.name());
        out.put("internal", desc.isInternal());
        out.put("partitions", partitions);
        out.put("totalMessages", total);
        out.put("configs", topicConfigs(s, topic));
        return out;
    }

    void createTopic(String connectionId, String topic, int partitions, int replication,
                     Map<String, String> configs) throws Exception {
        Session s = session(connectionId);
        NewTopic newTopic = new NewTopic(topic, partitions, (short) replication);
        if (configs != null && !configs.isEmpty()) {
            newTopic.configs(configs);
        }
        try {
            s.admin.createTopics(Collections.singletonList(newTopic)).all()
                    .get(s.timeout, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            throw new IllegalArgumentException(friendly(e));
        }
    }

    void deleteTopic(String connectionId, String topic) throws Exception {
        Session s = session(connectionId);
        try {
            s.admin.deleteTopics(Collections.singletonList(topic)).all()
                    .get(s.timeout, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            throw new IllegalArgumentException(friendly(e));
        }
    }

    void addPartitions(String connectionId, String topic, int total) throws Exception {
        Session s = session(connectionId);
        try {
            s.admin.createPartitions(Collections.singletonMap(topic, NewPartitions.increaseTo(total)))
                    .all().get(s.timeout, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            throw new IllegalArgumentException(friendly(e));
        }
    }

    Map<String, Object> fetchMessages(String connectionId, String topic, int partition,
                                      String mode, long offset, int limit) throws Exception {
        Session s = session(connectionId);
        List<TopicPartition> all = partitions(s, topic);
        if (all.isEmpty()) {
            throw new IllegalArgumentException("主题没有分区: " + topic);
        }
        int cap = Math.max(1, Math.min(MAX_FETCH, limit));
        List<TopicPartition> selected = new ArrayList<TopicPartition>();
        if (partition >= 0) {
            for (TopicPartition tp : all) {
                if (tp.partition() == partition) {
                    selected.add(tp);
                }
            }
            if (selected.isEmpty()) {
                throw new IllegalArgumentException("分区不存在: " + partition);
            }
        } else {
            selected.addAll(all);
        }
        synchronized (s.consumerLock) {
            KafkaConsumer<byte[], byte[]> consumer = s.consumer(s.serverProps);
            consumer.assign(selected);
            Map<TopicPartition, Long> begins = consumer.beginningOffsets(selected);
            Map<TopicPartition, Long> ends = consumer.endOffsets(selected);
            int perPartition = Math.max(1, (int) Math.ceil(cap / (double) selected.size()));
            boolean hasData = false;
            for (TopicPartition tp : selected) {
                long begin = value(begins.get(tp));
                long end = value(ends.get(tp));
                long start;
                if ("earliest".equals(mode)) {
                    start = begin;
                } else if ("offset".equals(mode)) {
                    start = Math.max(begin, Math.min(offset, end));
                } else {
                    start = Math.max(begin, end - perPartition);
                }
                if (start < end) {
                    hasData = true;
                }
                consumer.seek(tp, start);
            }
            if (!hasData) {
                Map<String, Object> empty = new LinkedHashMap<String, Object>();
                empty.put("records", new ArrayList<Map<String, Object>>());
                empty.put("truncated", false);
                empty.put("partitions", selected.size());
                return empty;
            }
            List<ConsumerRecord<byte[], byte[]>> records = new ArrayList<ConsumerRecord<byte[], byte[]>>();
            long deadline = System.currentTimeMillis() + Math.min(15000, Math.max(2000, s.timeout));
            while (records.size() < cap && System.currentTimeMillis() < deadline) {
                ConsumerRecords<byte[], byte[]> batch = consumer.poll(Duration.ofMillis(400));
                for (ConsumerRecord<byte[], byte[]> record : batch) {
                    records.add(record);
                    if (records.size() >= cap * 2) {
                        break;
                    }
                }
            }
            final boolean newest = !"earliest".equals(mode) && !"offset".equals(mode);
            records.sort(new Comparator<ConsumerRecord<byte[], byte[]>>() {
                @Override
                public int compare(ConsumerRecord<byte[], byte[]> a, ConsumerRecord<byte[], byte[]> b) {
                    int byTime = Long.compare(a.timestamp(), b.timestamp());
                    if (byTime != 0) {
                        return newest ? -byTime : byTime;
                    }
                    return newest ? Long.compare(b.offset(), a.offset()) : Long.compare(a.offset(), b.offset());
                }
            });
            List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
            int count = 0;
            for (ConsumerRecord<byte[], byte[]> record : records) {
                if (count++ >= cap) {
                    break;
                }
                out.add(record(record));
            }
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("records", out);
            result.put("truncated", records.size() > cap);
            result.put("partitions", selected.size());
            return result;
        }
    }

    Map<String, Object> produce(String connectionId, final String topic, final String key,
                                final String value, final int partition,
                                List<Map<String, String>> headers) throws Exception {
        Session s = session(connectionId);
        List<Header> list = new ArrayList<Header>();
        if (headers != null) {
            for (Map<String, String> header : headers) {
                if (header == null) {
                    continue;
                }
                String name = header.get("key");
                if (name == null || name.trim().isEmpty()) {
                    continue;
                }
                String hValue = header.get("value");
                list.add(new RecordHeader(name, hValue == null ? null
                        : hValue.getBytes(StandardCharsets.UTF_8)));
            }
        }
        byte[] keyBytes = key == null || key.isEmpty() ? null : key.getBytes(StandardCharsets.UTF_8);
        byte[] valueBytes = value == null ? new byte[0] : value.getBytes(StandardCharsets.UTF_8);
        Integer part = partition < 0 ? null : partition;
        final ProducerRecord<byte[], byte[]> record = new ProducerRecord<byte[], byte[]>(
                topic, part, keyBytes, valueBytes, list);
        RecordMetadata meta = s.producer(s.serverProps).send(record).get(
                Math.max(5000, s.timeout), TimeUnit.MILLISECONDS);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("topic", meta.topic());
        out.put("partition", meta.partition());
        out.put("offset", meta.offset());
        out.put("timestamp", meta.timestamp());
        return out;
    }

    List<Map<String, Object>> groups(String connectionId) throws Exception {
        Session s = session(connectionId);
        Collection<ConsumerGroupListing> listings = s.admin.listConsumerGroups().all()
                .get(s.timeout, TimeUnit.MILLISECONDS);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (listings.isEmpty()) {
            return out;
        }
        List<String> ids = new ArrayList<String>();
        for (ConsumerGroupListing listing : listings) {
            ids.add(listing.groupId());
        }
        Map<String, ConsumerGroupDescription> descs = s.admin.describeConsumerGroups(ids).all()
                .get(s.timeout, TimeUnit.MILLISECONDS);
        for (ConsumerGroupListing listing : listings) {
            ConsumerGroupDescription desc = descs.get(listing.groupId());
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("groupId", listing.groupId());
            item.put("simple", listing.isSimpleConsumerGroup());
            item.put("state", desc == null ? "-" : desc.state().toString());
            item.put("members", desc == null ? 0 : desc.members().size());
            Set<String> topics = new HashSet<String>();
            if (desc != null) {
                for (MemberDescription member : desc.members()) {
                    for (TopicPartition tp : member.assignment().topicPartitions()) {
                        topics.add(tp.topic());
                    }
                }
            }
            item.put("topics", new ArrayList<String>(topics));
            out.add(item);
        }
        out.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return String.valueOf(a.get("groupId")).compareToIgnoreCase(
                        String.valueOf(b.get("groupId")));
            }
        });
        return out;
    }

    Map<String, Object> groupDetail(String connectionId, String groupId) throws Exception {
        Session s = session(connectionId);
        ConsumerGroupDescription desc = s.admin.describeConsumerGroups(
                Collections.singletonList(groupId)).all()
                .get(s.timeout, TimeUnit.MILLISECONDS).get(groupId);
        if (desc == null) {
            throw new IllegalArgumentException("消费组不存在: " + groupId);
        }
        Map<TopicPartition, OffsetAndMetadata> committed =
                s.admin.listConsumerGroupOffsets(groupId).partitionsToOffsetAndMetadata()
                        .get(s.timeout, TimeUnit.MILLISECONDS);
        Map<TopicPartition, OffsetSpec> latestReq = new HashMap<TopicPartition, OffsetSpec>();
        for (TopicPartition tp : committed.keySet()) {
            latestReq.put(tp, OffsetSpec.latest());
        }
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> ends =
                latestReq.isEmpty() ? Collections.<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo>emptyMap()
                        : s.admin.listOffsets(latestReq).all().get(s.timeout, TimeUnit.MILLISECONDS);

        List<Map<String, Object>> offsets = new ArrayList<Map<String, Object>>();
        long totalLag = 0;
        for (Map.Entry<TopicPartition, OffsetAndMetadata> entry : committed.entrySet()) {
            TopicPartition tp = entry.getKey();
            long current = entry.getValue() == null ? -1 : entry.getValue().offset();
            long end = offset(ends.get(tp));
            long lag = current < 0 ? -1 : Math.max(0, end - current);
            if (lag > 0) {
                totalLag += lag;
            }
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("topic", tp.topic());
            item.put("partition", tp.partition());
            item.put("current", current);
            item.put("end", end);
            item.put("lag", lag);
            offsets.add(item);
        }
        offsets.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int byTopic = String.valueOf(a.get("topic")).compareToIgnoreCase(
                        String.valueOf(b.get("topic")));
                if (byTopic != 0) {
                    return byTopic;
                }
                return Integer.compare(((Number) a.get("partition")).intValue(),
                        ((Number) b.get("partition")).intValue());
            }
        });
        List<Map<String, Object>> members = new ArrayList<Map<String, Object>>();
        for (MemberDescription member : desc.members()) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("memberId", member.consumerId());
            item.put("clientId", member.clientId());
            item.put("host", member.host());
            List<String> assigned = new ArrayList<String>();
            for (TopicPartition tp : member.assignment().topicPartitions()) {
                assigned.add(tp.topic() + "-" + tp.partition());
            }
            item.put("assignment", assigned);
            members.add(item);
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("groupId", groupId);
        out.put("state", desc.state().toString());
        out.put("protocol", desc.partitionAssignor());
        out.put("members", members);
        out.put("offsets", offsets);
        out.put("totalLag", totalLag);
        return out;
    }

    private List<Map<String, Object>> topicConfigs(Session s, String topic) throws Exception {
        ConfigResource resource = new ConfigResource(ConfigResource.Type.TOPIC, topic);
        Map<ConfigResource, Config> configs = s.admin.describeConfigs(Collections.singletonList(resource))
                .all().get(s.timeout, TimeUnit.MILLISECONDS);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        Config config = configs.get(resource);
        if (config == null) {
            return out;
        }
        for (ConfigEntry entry : config.entries()) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("name", entry.name());
            item.put("value", entry.value() == null ? "" : entry.value());
            item.put("source", entry.source() == null ? "" : entry.source().name());
            item.put("readOnly", entry.isReadOnly());
            item.put("sensitive", entry.isSensitive());
            out.add(item);
        }
        out.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return String.valueOf(a.get("name")).compareTo(String.valueOf(b.get("name")));
            }
        });
        return out;
    }

    private List<TopicPartition> partitions(Session s, String topic) throws Exception {
        TopicDescription desc = s.admin.describeTopics(Collections.singletonList(topic))
                .all().get(s.timeout, TimeUnit.MILLISECONDS).get(topic);
        if (desc == null) {
            throw new IllegalArgumentException("主题不存在: " + topic);
        }
        List<TopicPartition> out = new ArrayList<TopicPartition>();
        for (org.apache.kafka.common.TopicPartitionInfo info : desc.partitions()) {
            out.add(new TopicPartition(topic, info.partition()));
        }
        return out;
    }

    private static Map<String, Object> record(ConsumerRecord<byte[], byte[]> record) {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("partition", record.partition());
        item.put("offset", record.offset());
        item.put("timestamp", record.timestamp());
        item.put("timestampType", record.timestampType() == null
                ? "" : record.timestampType().name);
        String[] key = text(record.key());
        item.put("key", key[0]);
        item.put("keyEncoding", key[1]);
        String[] value = text(record.value());
        item.put("value", value[0]);
        item.put("valueEncoding", value[1]);
        item.put("size", (record.key() == null ? 0 : record.key().length)
                + (record.value() == null ? 0 : record.value().length));
        List<Map<String, Object>> headers = new ArrayList<Map<String, Object>>();
        for (Header header : record.headers()) {
            String[] hv = text(header.value());
            Map<String, Object> h = new LinkedHashMap<String, Object>();
            h.put("key", header.key());
            h.put("value", hv[0]);
            h.put("encoding", hv[1]);
            headers.add(h);
        }
        item.put("headers", headers);
        return item;
    }

    /** 返回 {文本, 编码}；不可打印内容使用 Base64，避免前端渲染乱码。 */
    private static String[] text(byte[] data) {
        if (data == null || data.length == 0) {
            return new String[]{"", "text"};
        }
        boolean binary = false;
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        String value = null;
        try {
            value = decoder.decode(ByteBuffer.wrap(data)).toString();
        } catch (CharacterCodingException e) {
            binary = true;
        }
        if (value != null) {
            int controls = 0;
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                if (c < 0x20 && c != '\n' && c != '\r' && c != '\t') {
                    controls++;
                }
            }
            if (controls > 0 && controls * 10 > value.length()) {
                binary = true;
            }
        }
        if (binary) {
            return new String[]{Base64.getEncoder().encodeToString(data), "base64"};
        }
        boolean truncated = value.length() > MESSAGE_TEXT_LIMIT;
        if (truncated) {
            value = value.substring(0, MESSAGE_TEXT_LIMIT);
        }
        return new String[]{value, truncated ? "text-truncated" : "text"};
    }

    private static Map<String, Object> node(Node node, boolean controller) {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", node.id());
        item.put("host", node.host());
        item.put("port", node.port());
        item.put("rack", node.rack() == null ? "" : node.rack());
        item.put("controller", controller);
        return item;
    }

    private static List<Integer> ids(List<Node> nodes) {
        List<Integer> out = new ArrayList<Integer>();
        if (nodes != null) {
            for (Node node : nodes) {
                out.add(node.id());
            }
        }
        return out;
    }

    private static long offset(ListOffsetsResult.ListOffsetsResultInfo info) {
        return info == null ? 0 : info.offset();
    }

    private static long value(Long v) {
        return v == null ? 0 : v.longValue();
    }

    private Session session(String connectionId) {
        pruneSessions();
        Session session = connectionId == null ? null : sessions.get(connectionId);
        if (session == null) {
            throw new IllegalArgumentException("Kafka 连接已断开，请重新连接");
        }
        session.lastUsed = System.currentTimeMillis();
        return session;
    }

    private void pruneSessions() {
        long cutoff = System.currentTimeMillis() - IDLE_TIMEOUT_MS;
        for (Map.Entry<String, Session> entry : sessions.entrySet()) {
            Session session = entry.getValue();
            if (session.lastUsed < cutoff && sessions.remove(entry.getKey(), session)) {
                session.close();
            }
        }
    }

    private void trimSessions() {
        while (sessions.size() > MAX_SESSIONS) {
            String oldestId = null;
            Session oldest = null;
            for (Map.Entry<String, Session> entry : sessions.entrySet()) {
                if (oldest == null || entry.getValue().lastUsed < oldest.lastUsed) {
                    oldest = entry.getValue();
                    oldestId = entry.getKey();
                }
            }
            if (oldest == null || !sessions.remove(oldestId, oldest)) {
                break;
            }
            oldest.close();
        }
    }

    private static Properties baseProps(String servers, String securityProtocol,
                                        String saslMechanism, String username, String password,
                                        String clientId, int timeoutMs) {
        Properties props = new Properties();
        props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, servers);
        props.put(AdminClientConfig.CLIENT_ID_CONFIG,
                clientId == null || clientId.trim().isEmpty() ? "deepshell-kafka" : clientId.trim());
        props.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, timeoutMs);
        props.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, Math.max(timeoutMs, 10000));
        String protocol = securityProtocol == null || securityProtocol.trim().isEmpty()
                ? "PLAINTEXT" : securityProtocol.trim().toUpperCase();
        props.put("security.protocol", protocol);
        if (protocol.startsWith("SASL")) {
            String mechanism = saslMechanism == null || saslMechanism.trim().isEmpty()
                    ? "PLAIN" : saslMechanism.trim().toUpperCase();
            props.put("sasl.mechanism", mechanism);
            String loginModule = "SCRAM".equals(mechanism)
                    ? "org.apache.kafka.common.security.scram.ScramLoginModule"
                    : "org.apache.kafka.common.security.plain.PlainLoginModule";
            props.put("sasl.jaas.config", loginModule + " required username=\""
                    + escape(username) + "\" password=\"" + escape(password) + "\";");
        }
        return props;
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String friendly(Exception e) {
        Throwable cause = e;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String msg = cause.getMessage();
        if (msg == null || msg.trim().isEmpty()) {
            msg = cause.getClass().getSimpleName();
        }
        if (msg.contains("Connection to node") && msg.contains("could not be established")) {
            return "无法连接 Kafka Broker：" + msg;
        }
        return msg;
    }

    private static final class Session {
        final AdminClient admin;
        final Properties serverProps;
        final long timeout;
        final Object consumerLock = new Object();
        volatile long lastUsed = System.currentTimeMillis();
        private KafkaProducer<byte[], byte[]> producer;
        private KafkaConsumer<byte[], byte[]> consumer;

        Session(AdminClient admin, Properties serverProps, long timeout) {
            this.admin = admin;
            this.serverProps = serverProps;
            this.timeout = timeout;
        }

        KafkaProducer<byte[], byte[]> producer(Properties base) {
            if (producer == null) {
                Properties props = new Properties();
                props.putAll(base);
                props.put(ProducerConfig.ACKS_CONFIG, "all");
                props.put(ProducerConfig.RETRIES_CONFIG, "3");
                props.put(ProducerConfig.LINGER_MS_CONFIG, "0");
                props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "1");
                props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
                props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
                producer = new KafkaProducer<byte[], byte[]>(props);
            }
            return producer;
        }

        KafkaConsumer<byte[], byte[]> consumer(Properties base) {
            if (consumer == null) {
                Properties props = new Properties();
                props.putAll(base);
                props.put(ConsumerConfig.GROUP_ID_CONFIG, "deepshell-browser-" + UUID.randomUUID());
                props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
                props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
                props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "500");
                props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
                props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
                consumer = new KafkaConsumer<byte[], byte[]>(props);
            }
            return consumer;
        }

        void close() {
            synchronized (consumerLock) {
                if (consumer != null) {
                    try {
                        consumer.wakeup();
                    } catch (Exception ignore) {
                        // ignore
                    }
                    try {
                        consumer.close(Duration.ofMillis(1200));
                    } catch (Exception ignore) {
                        // ignore
                    }
                    consumer = null;
                }
            }
            if (producer != null) {
                try {
                    producer.close(Duration.ofMillis(1200));
                } catch (Exception ignore) {
                    // ignore
                }
                producer = null;
            }
            try {
                admin.close(Duration.ofMillis(1500));
            } catch (Exception ignore) {
                // ignore
            }
        }
    }
}
