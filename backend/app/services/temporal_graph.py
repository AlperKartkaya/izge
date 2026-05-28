from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Artifact,
    Assumption,
    ClaimFamily,
    ClaimOccurrence,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    GraphNode,
    Outcome,
    User,
)
from app.services.permissions import artifact_is_visible_to_user

MEMORY_MODELS = [
    ("decision", Decision, "decision_id", "status"),
    ("assumption", Assumption, "assumption_id", "status"),
    ("constraint", Constraint, "constraint_id", "category"),
    ("outcome", Outcome, "outcome_id", "outcome_type"),
    ("commitment", Commitment, "commitment_id", "status"),
]


def _family_key(memory_type: str, topic_key: str, title: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", f"{topic_key} {title}".lower())
    useful = [token for token in tokens if len(token) > 2 and token not in {"the", "and", "for", "with", "that", "this"}]
    return f"{memory_type}:{'-'.join(useful[:8]) or 'general'}"


def _status_for(memory_type: str, row: Any, incoming_edges: list[GraphEdge], outgoing_edges: list[GraphEdge]) -> str:
    edge_types = {edge.edge_type for edge in incoming_edges + outgoing_edges}
    raw_status = getattr(row, "status", None)
    if "CONTRADICTS" in edge_types:
        return "contested"
    if "SUPERSEDES" in {edge.edge_type for edge in incoming_edges}:
        return "superseded"
    if memory_type == "assumption" and raw_status in {"stale", "reversed", "invalidated", "weakening"}:
        return "stale"
    if raw_status in {"open", "active", "accepted", "noted"}:
        return "active"
    return str(raw_status or "first_seen")


def _node_edge_indexes(db: Session, workspace_id: str) -> tuple[dict[str, GraphNode], dict[str, list[GraphEdge]], dict[str, list[GraphEdge]], dict[str, GraphNode]]:
    graph_nodes = db.scalars(select(GraphNode).where(GraphNode.workspace_id == workspace_id)).all()
    node_by_entity = {node.entity_id: node for node in graph_nodes}
    node_by_id = {node.node_id: node for node in graph_nodes}
    edges = db.scalars(select(GraphEdge).where(GraphEdge.workspace_id == workspace_id)).all()
    outgoing_by_node: dict[str, list[GraphEdge]] = defaultdict(list)
    incoming_by_node: dict[str, list[GraphEdge]] = defaultdict(list)
    for edge in edges:
        outgoing_by_node[edge.from_node_id].append(edge)
        incoming_by_node[edge.to_node_id].append(edge)
    return node_by_entity, outgoing_by_node, incoming_by_node, node_by_id


def _memory_rows_for_workspace(db: Session, workspace_id: str) -> list[tuple[str, Any, str]]:
    artifact_ids = {
        artifact.artifact_id
        for artifact in db.scalars(select(Artifact).where(Artifact.workspace_id == workspace_id, Artifact.review_status != "rejected")).all()
    }
    if not artifact_ids:
        return []

    memory_rows: list[tuple[str, Any, str]] = []
    for memory_type, model, id_attr, _status_attr in MEMORY_MODELS:
        rows = db.scalars(
            select(model)
            .where(model.workspace_id == workspace_id, model.source_artifact_id.in_(artifact_ids))
            .order_by(model.event_timestamp.asc(), getattr(model, id_attr))
        ).all()
        for row in rows:
            memory_rows.append((memory_type, row, str(getattr(row, id_attr))))
    return memory_rows


def sync_temporal_claims(db: Session, *, workspace_id: str) -> dict[str, Any]:
    """Persist the temporal claim-family/occurrence projection from trusted memory rows.

    The memory tables remain the source of truth. This projection gives the product a first-class temporal KG substrate
    with validity windows and status history that can be inspected, replayed, and permission-filtered on reads.
    """

    node_by_entity, outgoing_by_node, incoming_by_node, _node_by_id = _node_edge_indexes(db, workspace_id)
    memory_rows = _memory_rows_for_workspace(db, workspace_id)
    current_memory_keys = {(memory_type, memory_id) for memory_type, _row, memory_id in memory_rows}
    if current_memory_keys:
        stale_occurrences = db.scalars(select(ClaimOccurrence).where(ClaimOccurrence.workspace_id == workspace_id)).all()
        for occurrence in stale_occurrences:
            if (occurrence.memory_type, occurrence.memory_id) not in current_memory_keys:
                db.delete(occurrence)
    else:
        db.execute(delete(ClaimOccurrence).where(ClaimOccurrence.workspace_id == workspace_id))
        db.execute(delete(ClaimFamily).where(ClaimFamily.workspace_id == workspace_id))
        db.flush()
        return {"family_count": 0, "occurrence_count": 0, "synced": True}

    families_by_key = {
        family.claim_family_key: family
        for family in db.scalars(select(ClaimFamily).where(ClaimFamily.workspace_id == workspace_id)).all()
    }
    occurrences_by_memory = {
        (occurrence.memory_type, occurrence.memory_id): occurrence
        for occurrence in db.scalars(select(ClaimOccurrence).where(ClaimOccurrence.workspace_id == workspace_id)).all()
    }

    grouped: dict[str, list[tuple[str, Any, str, str]]] = defaultdict(list)
    for memory_type, row, memory_id in memory_rows:
        family_key = _family_key(memory_type, row.topic_key, row.title_or_label)
        grouped[family_key].append((memory_type, row, memory_id, family_key))

    for family_key, family_rows in grouped.items():
        ordered_rows = sorted(family_rows, key=lambda item: (item[1].event_timestamp, item[2]))
        first_row = ordered_rows[0][1]
        latest_row = ordered_rows[-1][1]
        first_seen = first_row.event_timestamp
        latest_seen = latest_row.event_timestamp
        latest_memory_type = ordered_rows[-1][0]
        latest_memory_id = ordered_rows[-1][2]
        latest_node = node_by_entity.get(latest_memory_id)
        latest_status = _status_for(
            latest_memory_type,
            latest_row,
            incoming_by_node.get(latest_node.node_id, []) if latest_node else [],
            outgoing_by_node.get(latest_node.node_id, []) if latest_node else [],
        )
        family = families_by_key.get(family_key)
        if family is None:
            family = ClaimFamily(
                workspace_id=workspace_id,
                claim_family_key=family_key,
                memory_type=latest_memory_type,
                title_or_label=latest_row.title_or_label[:255],
                first_seen_at=first_seen,
                latest_seen_at=latest_seen,
                status=latest_status,
                occurrence_count=len(ordered_rows),
            )
            db.add(family)
            db.flush()
            families_by_key[family_key] = family
        else:
            family.memory_type = latest_memory_type
            family.title_or_label = latest_row.title_or_label[:255]
            family.first_seen_at = first_seen
            family.latest_seen_at = latest_seen
            family.status = latest_status
            family.occurrence_count = len(ordered_rows)

        for index, (memory_type, row, memory_id, _family_key_value) in enumerate(ordered_rows):
            node = node_by_entity.get(memory_id)
            incoming_edges = incoming_by_node.get(node.node_id, []) if node else []
            outgoing_edges = outgoing_by_node.get(node.node_id, []) if node else []
            occurrence_id = f"occ_{memory_type}_{memory_id}"
            valid_to = ordered_rows[index + 1][1].event_timestamp if index + 1 < len(ordered_rows) else None
            status = _status_for(memory_type, row, incoming_edges, outgoing_edges)
            occurrence = occurrences_by_memory.get((memory_type, memory_id))
            payload_json = {
                "schema_version": "claim_occurrence_projection.v1",
                "claim_family_key": family_key,
                "topic_key": row.topic_key,
                "extraction_method": row.extraction_method,
                "incoming_edge_count": len(incoming_edges),
                "outgoing_edge_count": len(outgoing_edges),
                "validity_window_source": "next_occurrence_in_family" if valid_to else "latest_observation",
            }
            if occurrence is None:
                occurrence = ClaimOccurrence(
                    occurrence_id=occurrence_id,
                    family_id=family.family_id,
                    workspace_id=workspace_id,
                    memory_type=memory_type,
                    memory_id=memory_id,
                    source_artifact_id=row.source_artifact_id,
                    source_chunk_id=row.source_chunk_id,
                    title_or_label=row.title_or_label[:255],
                    observed_at=row.event_timestamp,
                    valid_from=row.event_timestamp,
                    valid_to=valid_to,
                    status=status,
                    confidence_score=row.confidence_score,
                    evidence_span=row.evidence_span,
                    payload_json=payload_json,
                )
                db.add(occurrence)
            else:
                occurrence.family_id = family.family_id
                occurrence.source_artifact_id = row.source_artifact_id
                occurrence.source_chunk_id = row.source_chunk_id
                occurrence.title_or_label = row.title_or_label[:255]
                occurrence.observed_at = row.event_timestamp
                occurrence.valid_from = row.event_timestamp
                occurrence.valid_to = valid_to
                occurrence.status = status
                occurrence.confidence_score = row.confidence_score
                occurrence.evidence_span = row.evidence_span
                occurrence.payload_json = payload_json
            if valid_to is None:
                family.active_occurrence_id = occurrence.occurrence_id

    active_family_keys = set(grouped)
    inactive_family_ids = [
        family.family_id
        for family in families_by_key.values()
        if family.family_id and family.claim_family_key not in active_family_keys
    ]
    if inactive_family_ids:
        db.execute(
            delete(ClaimOccurrence).where(
                ClaimOccurrence.workspace_id == workspace_id,
                ClaimOccurrence.family_id.in_(inactive_family_ids),
            )
        )
        db.execute(
            delete(ClaimFamily).where(
                ClaimFamily.workspace_id == workspace_id,
                ClaimFamily.family_id.in_(inactive_family_ids),
            )
        )

    db.flush()
    return {
        "family_count": len(grouped),
        "occurrence_count": sum(len(rows) for rows in grouped.values()),
        "synced": True,
    }


def build_temporal_graph(db: Session, user: User, *, limit: int = 80) -> dict[str, Any]:
    sync_summary = sync_temporal_claims(db, workspace_id=user.workspace_id)
    db.commit()

    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id)).all()
    visible_artifact_ids = {
        artifact.artifact_id
        for artifact in artifacts
        if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
    }
    artifact_titles = {artifact.artifact_id: artifact.title for artifact in artifacts if artifact.artifact_id in visible_artifact_ids}
    if not visible_artifact_ids:
        return {"workspace_id": user.workspace_id, "families": [], "occurrences": [], "links": [], "sync_summary": sync_summary}

    occurrences = db.scalars(
        select(ClaimOccurrence)
        .where(ClaimOccurrence.workspace_id == user.workspace_id, ClaimOccurrence.source_artifact_id.in_(visible_artifact_ids))
        .order_by(ClaimOccurrence.observed_at.desc(), ClaimOccurrence.occurrence_id)
        .limit(limit)
    ).all()
    kept_occurrence_ids = {occurrence.occurrence_id for occurrence in occurrences}
    kept_memory_ids = {occurrence.memory_id for occurrence in occurrences}
    family_ids = {occurrence.family_id for occurrence in occurrences}
    families_by_id = {
        family.family_id: family
        for family in db.scalars(select(ClaimFamily).where(ClaimFamily.workspace_id == user.workspace_id, ClaimFamily.family_id.in_(family_ids))).all()
    }

    occurrence_payloads = [
        {
            "occurrence_id": occurrence.occurrence_id,
            "family_id": occurrence.family_id,
            "memory_type": occurrence.memory_type,
            "memory_id": occurrence.memory_id,
            "claim_family_key": families_by_id.get(occurrence.family_id).claim_family_key if families_by_id.get(occurrence.family_id) else "unknown",
            "title_or_label": occurrence.title_or_label,
            "observed_at": occurrence.observed_at,
            "valid_from": occurrence.valid_from,
            "valid_to": occurrence.valid_to,
            "source_artifact_id": occurrence.source_artifact_id,
            "source_artifact_title": artifact_titles.get(occurrence.source_artifact_id, "Unknown artifact"),
            "source_chunk_id": occurrence.source_chunk_id,
            "evidence_span": occurrence.evidence_span,
            "status": occurrence.status,
            "confidence_score": occurrence.confidence_score,
        }
        for occurrence in occurrences
    ]

    families_payload = [
        {
            "family_id": family.family_id,
            "claim_family_key": family.claim_family_key,
            "memory_type": family.memory_type,
            "title_or_label": family.title_or_label,
            "status": family.status,
            "first_seen_at": family.first_seen_at,
            "latest_seen_at": family.latest_seen_at,
            "active_occurrence_id": family.active_occurrence_id,
            "occurrence_count": family.occurrence_count,
        }
        for family in sorted(families_by_id.values(), key=lambda item: (item.latest_seen_at, item.claim_family_key), reverse=True)
    ]

    graph_nodes = db.scalars(select(GraphNode).where(GraphNode.workspace_id == user.workspace_id, GraphNode.entity_id.in_(kept_memory_ids))).all()
    node_by_entity = {node.entity_id: node for node in graph_nodes}
    node_by_id = {node.node_id: node for node in graph_nodes}
    occurrence_ids_by_entity = {occurrence.memory_id: occurrence.occurrence_id for occurrence in occurrences}
    visible_node_ids = {node.node_id for node in graph_nodes}
    edges = [
        edge
        for edge in db.scalars(select(GraphEdge).where(GraphEdge.workspace_id == user.workspace_id)).all()
        if edge.from_node_id in visible_node_ids
        and edge.to_node_id in visible_node_ids
        and (edge.evidence_artifact_id is None or edge.evidence_artifact_id in visible_artifact_ids)
    ]

    links: list[dict[str, Any]] = []
    for edge in edges:
        from_node = node_by_id.get(edge.from_node_id)
        to_node = node_by_id.get(edge.to_node_id)
        if not from_node or not to_node:
            continue
        from_occurrence_id = occurrence_ids_by_entity.get(from_node.entity_id)
        to_occurrence_id = occurrence_ids_by_entity.get(to_node.entity_id)
        if not from_occurrence_id or not to_occurrence_id:
            continue
        if from_occurrence_id not in kept_occurrence_ids or to_occurrence_id not in kept_occurrence_ids:
            continue
        links.append(
            {
                "edge_id": edge.edge_id,
                "edge_type": edge.edge_type,
                "from_occurrence_id": from_occurrence_id,
                "to_occurrence_id": to_occurrence_id,
                "evidence_artifact_id": edge.evidence_artifact_id,
                "evidence_chunk_id": edge.evidence_chunk_id,
                "confidence_score": edge.confidence_score,
            }
        )

    return {
        "workspace_id": user.workspace_id,
        "families": families_payload,
        "occurrences": occurrence_payloads,
        "links": links[: limit * 2],
        "sync_summary": sync_summary,
    }
