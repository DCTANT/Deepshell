package com.itdct.deepshell.dto;

import lombok.Data;

@Data
public class PortForwardForm {

    private Long id;
    private Long connectionId;
    /** LOCAL / REMOTE */
    private String direction;
    private String bindHost;
    private Integer bindPort;
    private String destHost;
    private Integer destPort;
    private Boolean autoStart;
}
