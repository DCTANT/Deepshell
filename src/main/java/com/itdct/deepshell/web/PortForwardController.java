package com.itdct.deepshell.web;

import com.itdct.deepshell.common.R;
import com.itdct.deepshell.dto.PortForwardForm;
import com.itdct.deepshell.service.PortForwardService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/port-forwards")
public class PortForwardController {

    private final PortForwardService service;

    public PortForwardController(PortForwardService service) {
        this.service = service;
    }

    @GetMapping
    public R<List<Map<String, Object>>> list(@RequestParam("connectionId") Long connectionId,
                                             @RequestParam(value = "sessionId", required = false) String sessionId) {
        return R.ok(service.list(connectionId, sessionId));
    }

    @PostMapping
    public R<Map<String, Object>> create(@RequestBody PortForwardForm form,
                                         @RequestParam(value = "sessionId", required = false) String sessionId) {
        return R.ok(service.create(form, sessionId));
    }

    @PutMapping("/{id}")
    public R<Map<String, Object>> update(@PathVariable("id") Long id, @RequestBody PortForwardForm form,
                                         @RequestParam(value = "sessionId", required = false) String sessionId) {
        return R.ok(service.update(id, form, sessionId));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable("id") Long id,
                          @RequestParam(value = "sessionId", required = false) String sessionId) {
        service.delete(id, sessionId);
        return R.ok();
    }

    @PostMapping("/{id}/start")
    public R<PortForwardService.RuntimeForward> start(@PathVariable("id") Long id,
                                                      @RequestParam("sessionId") String sessionId) {
        return R.ok(service.start(id, sessionId));
    }

    @PostMapping("/{id}/stop")
    public R<Void> stop(@PathVariable("id") Long id, @RequestParam("sessionId") String sessionId) {
        service.stop(id, sessionId);
        return R.ok();
    }
}
