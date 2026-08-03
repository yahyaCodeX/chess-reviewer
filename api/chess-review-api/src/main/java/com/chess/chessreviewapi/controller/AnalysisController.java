package com.chess.chessreviewapi.controller;

import com.chess.chessreviewapi.model.AnalyzedMove;
import com.chess.chessreviewapi.repository.AnalyzedMoveRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/analysis/")
@CrossOrigin(origins = "*")
public class AnalysisController {
    @Autowired
    private AnalyzedMoveRepository analyzedMoveRepository;
    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @GetMapping("/moves")
    public ResponseEntity<List<AnalyzedMove>> getAllMoves(){
        List<AnalyzedMove> moves=analyzedMoveRepository.findAll();
        return ResponseEntity.ok(moves);
    }
    @DeleteMapping("/clear")
    public ResponseEntity<String> clearMoves() {
        analyzedMoveRepository.deleteAll();
        return ResponseEntity.ok("All moves cleared");
    }
    @PostMapping("submit")
    public ResponseEntity<String> submitGame(@RequestBody String gamePgn){
        String gameId= UUID.randomUUID().toString();
        String jsonPayload = String.format("{\"gameId\":\"%s\", \"pgn\":\"%s\"}",
                gameId,
                gamePgn.replace("\n", "\\n").replace("\"", "\\\"")); // Safely escape the PGN

        // 3. Send the packaged JSON to Kafka
        kafkaTemplate.send("games-to-analyze", jsonPayload);

        System.out.println("Received new game to analyze");
        System.out.println(gamePgn);
        return ResponseEntity.ok(gameId);
    }
}
