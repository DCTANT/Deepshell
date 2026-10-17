package com.itdct.deepshell.service;

import com.itdct.deepshell.entity.CommonDir;
import com.itdct.deepshell.repo.CommonDirRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CommonDirServiceTest {

    @Mock
    private CommonDirRepository repo;

    @InjectMocks
    private CommonDirService service;

    @Test
    void listRequiresConnection() {
        assertThrows(IllegalArgumentException.class, () -> service.list(null));
        verifyNoInteractions(repo);
    }

    @Test
    void addBindsToConnectionAndChecksDuplicateWithinIt() {
        when(repo.findByConnectionIdAndPath(7L, "/srv/app")).thenReturn(Optional.empty());
        when(repo.save(any(CommonDir.class))).thenAnswer(inv -> (CommonDir) inv.getArgument(0));

        CommonDir d = service.add(7L, "  /srv/app  ");

        assertEquals(7L, d.getConnectionId());
        assertEquals("/srv/app", d.getPath());
        verify(repo).findByConnectionIdAndPath(7L, "/srv/app");
    }

    @Test
    void addRejectsDuplicateForSameHost() {
        when(repo.findByConnectionIdAndPath(7L, "/srv/app"))
                .thenReturn(Optional.of(new CommonDir()));

        assertThrows(IllegalArgumentException.class, () -> service.add(7L, "/srv/app"));
        verify(repo, never()).save(any());
    }

    @Test
    void deleteRejectsDirectoryOfAnotherHost() {
        CommonDir d = new CommonDir();
        d.setId(3L);
        d.setConnectionId(8L);
        when(repo.findById(3L)).thenReturn(Optional.of(d));

        assertThrows(IllegalArgumentException.class, () -> service.delete(7L, 3L));
        verify(repo, never()).delete(any());
    }

    @Test
    void deleteRemovesOwnedDirectory() {
        CommonDir d = new CommonDir();
        d.setId(3L);
        d.setConnectionId(7L);
        when(repo.findById(3L)).thenReturn(Optional.of(d));

        service.delete(7L, 3L);

        verify(repo).delete(d);
    }
}
