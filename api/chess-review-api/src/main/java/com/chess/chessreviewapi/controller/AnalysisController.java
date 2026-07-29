package com.chess.chessreviewapi.controller;

import com.chess.chessreviewapi.model.AnalyzedMove;
import com.chess.chessreviewapi.repository.AnalyzedMoveRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;

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
        kafkaTemplate.send("games-to-analyze",gamePgn);
        System.out.println("Received new game to analyze");
        System.out.println(gamePgn);
        return ResponseEntity.ok("Game received and added to the analysis queue");
    }
}
