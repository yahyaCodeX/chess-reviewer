FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KAFKA_CERT_DIR=/app/certs

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py opening_book.py ./
COPY openings/ openings/
# x86-64 Linux build (tracked with Git LFS — run `git lfs pull` before building)
COPY engine/stockfish-linux engine/stockfish-linux
RUN chmod +x engine/stockfish-linux \
 && useradd --system --no-create-home worker
USER worker

CMD ["python", "main.py"]
