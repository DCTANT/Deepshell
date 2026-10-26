package com.itdct.deepshell.mcp;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** 一个 MCP 工具的定义（名称、说明与 JSON Schema）。 */
public final class McpTool {

    private final String name;
    private final String title;
    private final String description;
    private final Map<String, Object> inputSchema;

    public McpTool(String name, String title, String description, Map<String, Object> inputSchema) {
        this.name = name;
        this.title = title;
        this.description = description;
        this.inputSchema = inputSchema == null
                ? Collections.<String, Object>emptyMap() : inputSchema;
    }

    public String getName() {
        return name;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    /** 便捷构造属性表：props("name", stringProp("..."), "count", intProp("...", 1, 10)) */
    static Map<String, Object> props(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            map.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return map;
    }

    static Map<String, Object> enumProp(String description, String... values) {
        Map<String, Object> p = stringProp(description);
        p.put("enum", java.util.Arrays.asList(values));
        return p;
    }

    /** 统一构造 object 类型 schema；required 为空时不写该字段。 */
    static Map<String, Object> schema(Map<String, Object> properties, String... required) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties == null ? Collections.emptyMap() : properties);
        if (required != null && required.length > 0) {
            schema.put("required", required);
        }
        schema.put("additionalProperties", false);
        return schema;
    }

    static Map<String, Object> stringProp(String description) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("type", "string");
        p.put("description", description);
        return p;
    }

    static Map<String, Object> intProp(String description, Integer minimum, Integer maximum) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("type", "integer");
        p.put("description", description);
        if (minimum != null) {
            p.put("minimum", minimum);
        }
        if (maximum != null) {
            p.put("maximum", maximum);
        }
        return p;
    }

    static Map<String, Object> boolProp(String description) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("type", "boolean");
        p.put("description", description);
        return p;
    }
}
