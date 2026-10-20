package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.KnownHost;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KnownHostRepository extends JpaRepository<KnownHost, Long> {

    List<KnownHost> findAllByOrderByHostAscPortAscKeyTypeAsc();

    List<KnownHost> findByHostAndPortOrderByIdAsc(String host, Integer port);

    Optional<KnownHost> findFirstByHostAndPortAndKeyTypeOrderByIdAsc(String host, Integer port, String keyType);

    void deleteByHostAndPortAndKeyType(String host, Integer port, String keyType);
}
