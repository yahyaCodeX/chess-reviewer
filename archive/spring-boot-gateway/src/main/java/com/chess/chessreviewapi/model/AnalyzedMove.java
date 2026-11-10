package com.chess.chessreviewapi.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;

// Ignore unknown fields so new worker payload fields never break the consumer
@JsonIgnoreProperties(ignoreUnknown = true)
@Entity
@Table(name="analyzed_move")
public class AnalyzedMove {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String gameId;
    @Column(name = "move_number")
    private Integer moveNumber;

    @Column(name = "player")
    private String player;

    @Column(name = "move_san")
    private String moveSan;

    @Column(name = "evaluation")
    private String evaluation;

    // Engine's best move (UCI) in the position before this move; null for book moves
    @Column(name = "best_move", length = 10)
    private String bestMove;

    // Eval of the second-best move in that position (detects "only moves")
    @Column(name = "alt_evaluation", length = 50)
    private String altEvaluation;

    // Opening name; non-null means this was a book move
    @Column(name = "opening", length = 150)
    private String opening;

    public String getBestMove() { return bestMove; }
    public void setBestMove(String bestMove) { this.bestMove = bestMove; }

    public String getAltEvaluation() { return altEvaluation; }
    public void setAltEvaluation(String altEvaluation) { this.altEvaluation = altEvaluation; }

    public String getOpening() { return opening; }
    public void setOpening(String opening) {
        this.opening = opening != null && opening.length() > 150 ? opening.substring(0, 150) : opening;
    }

    // --- Getters and Setters (Spring Boot needs these!) ---

    public String getGameId(){return gameId;}
    public void setGameId(String gameId){this.gameId=gameId;}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Integer getMoveNumber() { return moveNumber; }
    public void setMoveNumber(Integer moveNumber) { this.moveNumber = moveNumber; }

    public String getPlayer() { return player; }
    public void setPlayer(String player) { this.player = player; }

    public String getMoveSan() { return moveSan; }
    public void setMoveSan(String moveSan) { this.moveSan = moveSan; }

    public String getEvaluation() { return evaluation; }
    public void setEvaluation(String evaluation) { this.evaluation = evaluation; }
}
