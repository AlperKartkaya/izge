from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Artifact, Assumption, Commitment, Constraint, Decision, GraphEdge, GraphNode, Outcome, User
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
    if memory_type == "assumption" and raw_status in {"stale", "reversed", "invalidated"}:
        return "stale"
    if raw_status in {"open", "active", "accepted", "noted"}:
        return "active"
    return str(raw_status or "first_seen")


def build_temporal_graph(db: Session, user: User, *, limit: int = 80) -> dict[str, Any]:
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id)).all()
    visible_artifact_ids = {
        artifact.artifact_id
        for artifact in artifacts
        if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
    }
    artifact_titles = {artifact.artifact_id: artifact.title for artifact in artifacts if artifact.artifact_id in visible_artifact_ids}
    graph_nodes = db.scalars(select(GraphNode).where(GraphNode.workspace_id == user.workspace_id)).all()
    node_by_entity = {node.entity_id: node for node in graph_nodes}

    memory_rows: list[tuple[str, Any, str]] = []
    visible_entity_ids: set[str] = set()
    for memory_type, model, id_attr, _status_attr in MEMORY_MODELS:
        rows = db.scalars(
            select(model)
            .where(model.workspace_id == user.workspace_id, model.source_artifact_id.in_(visible_artifact_ids))
            .order_by(model.event_timestamp.desc())
            .limit(limit)
        ).all()
        for row in rows:
            memory_id = str(getattr(row, id_attr))
            visible_entity_ids.add(memory_id)
            memory_rows.append((memory_type, row, memory_id))

    visible_node_ids = {node.node_id for node in graph_nodes if node.entity_id in visible_entity_ids}
    edges = [
        edge
        for edge in db.scalars(select(GraphEdge).where(GraphEdge.workspace_id == user.workspace_id)).all()
        if edge.from_node_id in visible_node_ids
        and edge.to_node_id in visible_node_ids
        and (edge.evidence_artifact_id is None or edge.evidence_artifact_id in visible_artifact_ids)
    ]
    outgoing_by_node: dict[str, list[GraphEdge]] = {}
    incoming_by_node: dict[str, list[GraphEdge]] = {}
    for edge in edges:
        outgoing_by_node.setdefault(edge.from_node_id, []).append(edge)
        incoming_by_node.setdefault(edge.to_node_id, []).append(edge)

    occurrences: list[dict[str, Any]] = []
    occurrence_ids_by_entity: dict[str, str] = {}
    node_by_id = {node.node_id: node for node in graph_nodes}

    for memory_type, row, memory_id in memory_rows:
        node = node_by_entity.get(memory_id)
        incoming_edges = incoming_by_node.get(node.node_id, []) if node else []
        outgoing_edges = outgoing_by_node.get(node.node_id, []) if node else []
        occurrence_id = f"occ_{memory_type}_{memory_id}"
        occurrence_ids_by_entity[memory_id] = occurrence_id
        occurrences.append(
            {
                "occurrence_id": occurrence_id,
                "memory_type": memory_type,
                "memory_id": memory_id,
                "claim_family_key": _family_key(memory_type, row.topic_key, row.title_or_label),
                "title_or_label": row.title_or_label,
                "observed_at": row.event_timestamp,
                "source_artifact_id": row.source_artifact_id,
                "source_artifact_title": artifact_titles.get(row.source_artifact_id, "Unknown artifact"),
                "source_chunk_id": row.source_chunk_id,
                "evidence_span": row.evidence_span,
                "status": _status_for(memory_type, row, incoming_edges, outgoing_edges),
                "confidence_score": row.confidence_score,
            }
        )
    occurrences.sort(key=lambda item: item["observed_at"], reverse=True)
    occurrences = occurrences[:limit]
    kept_occurrence_ids = {item["occurrence_id"] for item in occurrences}

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
        if edge.evidence_artifact_id and edge.evidence_artifact_id not in visible_artifact_ids:
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

    return {"workspace_id": user.workspace_id, "occurrences": occurrences, "links": links[: limit * 2]}
