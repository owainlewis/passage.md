package database

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPoolBoundsConcurrentQueries(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := Open(ctx, databaseURL, 3)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	const workers = 24
	start := make(chan struct{})
	errs := make(chan error, workers)
	var active atomic.Int32
	var peak atomic.Int32
	var workersDone sync.WaitGroup
	workersDone.Add(workers)

	for range workers {
		go func() {
			defer workersDone.Done()
			<-start
			conn, err := db.Acquire(ctx)
			if err != nil {
				errs <- err
				return
			}
			current := active.Add(1)
			for {
				observed := peak.Load()
				if current <= observed || peak.CompareAndSwap(observed, current) {
					break
				}
			}
			_, err = conn.Exec(ctx, `SELECT pg_sleep(0.02)`)
			active.Add(-1)
			conn.Release()
			errs <- err
		}()
	}

	close(start)
	workersDone.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := peak.Load(); got != 3 {
		t.Fatalf("peak acquired connections = %d, want 3", got)
	}
	if got := db.Stat().MaxConns(); got != 3 {
		t.Fatalf("pool max connections = %d, want 3", got)
	}
}
