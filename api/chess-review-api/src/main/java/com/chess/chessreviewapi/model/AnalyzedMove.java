package com.chess.chessreviewapi.model;

import jakarta.persistence.*;

@Entity
@Table(name="analyzed_move")
public class AnalyzedMove {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "move_number")
    private Integer moveNumber;

    @Column(name = "player")
    private String player;

    @Column(name = "move_san")
    private String moveSan;

    @Column(name = "evaluation")
    private String evaluation;

    // --- Getters and Setters (Spring Boot needs these!) ---

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
