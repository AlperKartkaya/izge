from __future__ import annotations

import argparse
import time
from datetime import UTC, datetime

from app.db import SessionLocal
from app.migration_tools import upgrade_database
from app.services.automations import dispatch_due_automations
from app.services.colleague import (
    claim_next_colleague_run,
    default_worker_id,
    dispatch_due_reminders,
    enqueue_due_evening_reviews,
    process_colleague_run,
)


def run_worker(*, worker_id: str, poll_interval_seconds: float, once: bool, max_runs: int | None) -> int:
    upgrade_database()
    processed = 0
    while True:
        with SessionLocal() as db:
            now = datetime.now(UTC)
            enqueue_due_evening_reviews(db, now)
            dispatch_due_reminders(db, now)
            dispatch_due_automations(db, now)
            run = claim_next_colleague_run(db, worker_id=worker_id)
            if run is not None:
                lease_owner = run.lease_owner
                completed = process_colleague_run(db, run, lease_owner=lease_owner)
                processed += 1
                print(f"izge-colleague-worker run_id={completed.run_id} status={completed.status}")
        if once or (max_runs is not None and processed >= max_runs):
            return 0
        if run is None:
            time.sleep(max(poll_interval_seconds, 0.1))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the durable Izge colleague worker")
    parser.add_argument("--worker-id", default=default_worker_id())
    parser.add_argument("--poll-interval-seconds", type=float, default=1.0)
    parser.add_argument("--max-runs", type=int, default=None)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    raise SystemExit(
        run_worker(
            worker_id=args.worker_id,
            poll_interval_seconds=args.poll_interval_seconds,
            once=args.once,
            max_runs=args.max_runs,
        )
    )


if __name__ == "__main__":
    main()
