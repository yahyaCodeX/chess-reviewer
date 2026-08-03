package com.chess.chessreviewapi.service;

import com.chess.chessreviewapi.model.AnalyzedMove;
import com.chess.chessreviewapi.repository.AnalyzedMoveRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.websocket.server.ServerEndpoint;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

@Service
public class AnalysisListener {
    private final AnalyzedMoveRepository repository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public AnalysisListener(AnalyzedMoveRepository repository, SimpMessagingTemplate messagingTemplate){
        this.repository=repository;
        this.messagingTemplate=messagingTemplate;
        this.objectMapper=new ObjectMapper();
    }

    @KafkaListener(topics="analyzed-moves",groupId = "spring-boot-group")
    public void consumeAnalyzedMove(String moveJson){
        try{
            AnalyzedMove move=objectMapper.readValue(moveJson,AnalyzedMove.class);
            AnalyzedMove savedMove=repository.save(move);
            String gameId = savedMove.getGameId();
            System.out.println("Broadcasting Move "+ savedMove.getMoveNumber()+" to game channel /topic/moves/" + gameId);
            messagingTemplate.convertAndSend("/topic/moves/" + gameId, savedMove);
        }catch (JsonProcessingException e){
            System.out.println("Error Passing JSON from Kafka "+e.getMessage());
        }
    }

}
