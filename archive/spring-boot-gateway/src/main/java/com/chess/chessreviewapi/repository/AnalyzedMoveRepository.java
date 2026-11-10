package com.chess.chessreviewapi.repository;

import com.chess.chessreviewapi.model.AnalyzedMove;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AnalyzedMoveRepository extends JpaRepository<AnalyzedMove, Long> {
    List<AnalyzedMove> findByGameIdOrderByIdAsc(String gameId);
}
