package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Pool struct {
	*pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string, maxConnsOverride ...int32) (*Pool, error) {
	if len(maxConnsOverride) > 1 {
		return nil, errors.New("database max connections accepts one override")
	}
	if len(maxConnsOverride) == 1 && maxConnsOverride[0] <= 0 {
		return nil, errors.New("database max connections must be greater than zero")
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	if len(maxConnsOverride) == 1 {
		cfg.MaxConns = maxConnsOverride[0]
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Pool{Pool: pool}, nil
}
