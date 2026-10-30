package com.itdct.deepshell.repo;

import com.itdct.deepshell.entity.GatewayEndpoint;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GatewayEndpointRepository extends JpaRepository<GatewayEndpoint, Long> {

    List<GatewayEndpoint> findAllByOrderByIdAsc();
}
