package com.chess.chessreviewapi.controller;

import com.chess.chessreviewapi.model.AnalyzedMove;
import com.chess.chessreviewapi.repository.AnalyzedMoveRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/analysis")
@CrossOrigin(origins = "*")
public class AnalysisController {
    private static final int MAX_PGN_LENGTH = 64 * 1024;

    private final AnalyzedMoveRepository analyzedMoveRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${app.admin-token:}")
    private String adminToken;

    public AnalysisController(AnalyzedMoveRepository analyzedMoveRepository,
                              KafkaTemplate<String, String> kafkaTemplate) {
        this.analyzedMoveRepository = analyzedMoveRepository;
        this.kafkaTemplate = kafkaTemplate;
    }

    @GetMapping("/moves")
    public ResponseEntity<List<AnalyzedMove>> getMoves(@RequestParam(required = false) String gameId) {
        if (gameId != null && !gameId.isBlank()) {
            return ResponseEntity.ok(analyzedMoveRepository.findByGameIdOrderByIdAsc(gameId));
        }
        return ResponseEntity.ok(analyzedMoveRepository.findAll());
    }

    @DeleteMapping("/clear")
    public ResponseEntity<String> clearMoves(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        if (adminToken.isBlank() || !adminToken.equals(token)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Forbidden");
        }
        analyzedMoveRepository.deleteAll();
        return ResponseEntity.ok("All moves cleared");
    }

    @PostMapping("/submit")
    public ResponseEntity<String> submitGame(@RequestBody String gamePgn) throws JsonProcessingException {
        if (gamePgn == null || gamePgn.isBlank()) {
            return ResponseEntity.badRequest().body("PGN text must not be empty.");
        }
        if (gamePgn.length() > MAX_PGN_LENGTH) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body("PGN is too large.");
        }
        String gameId = UUID.randomUUID().toString();
        // Let Jackson do the escaping — hand-built JSON broke on tabs, backslashes and \r
        String jsonPayload = objectMapper.writeValueAsString(Map.of("gameId", gameId, "pgn", gamePgn.trim()));

        kafkaTemplate.send("games-to-analyze", gameId, jsonPayload);
        return ResponseEntity.ok(gameId);
    }
}
