// Fixed reviewed physical-source dictionary. Not runtime schema introspection.
export const fieldSourceSchema={
  "work_intervals": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "logical_id": {
        "type": "uuid",
        "nullable": false
      },
      "sequence": {
        "type": "bigint",
        "nullable": false
      },
      "replaces_id": {
        "type": "uuid",
        "nullable": true
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "operator_actor_id": {
        "type": "uuid",
        "nullable": false
      },
      "kind": {
        "type": "text",
        "nullable": false
      },
      "started_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "ended_at": {
        "type": "timestamp with time zone",
        "nullable": true
      },
      "pause_reason": {
        "type": "text",
        "nullable": true
      },
      "change_kind": {
        "type": "text",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id",
          "operator_actor_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id",
          "operator_actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "replaces_id",
          "logical_id",
          "job_id",
          "operator_actor_id"
        ],
        "target": "crest.work_intervals",
        "targetColumns": [
          "business_id",
          "id",
          "logical_id",
          "job_id",
          "operator_actor_id"
        ]
      }
    ]
  },
  "travel_legs": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "logical_id": {
        "type": "uuid",
        "nullable": false
      },
      "sequence": {
        "type": "bigint",
        "nullable": false
      },
      "replaces_id": {
        "type": "uuid",
        "nullable": true
      },
      "operator_actor_id": {
        "type": "uuid",
        "nullable": false
      },
      "driven_vehicle_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_context_id": {
        "type": "uuid",
        "nullable": true
      },
      "purpose": {
        "type": "text",
        "nullable": false
      },
      "origin_snapshot": {
        "type": "jsonb",
        "nullable": false
      },
      "destination_snapshot": {
        "type": "jsonb",
        "nullable": false
      },
      "departed_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "arrived_at": {
        "type": "timestamp with time zone",
        "nullable": true
      },
      "state": {
        "type": "text",
        "nullable": false
      },
      "eta_at": {
        "type": "timestamp with time zone",
        "nullable": true
      },
      "eta_source": {
        "type": "text",
        "nullable": true
      },
      "eta_calculated_at": {
        "type": "timestamp with time zone",
        "nullable": true
      },
      "notes": {
        "type": "text",
        "nullable": true
      },
      "change_kind": {
        "type": "text",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "driven_vehicle_id"
        ],
        "target": "crest.vehicles",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_context_id",
          "operator_actor_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id",
          "operator_actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operator_actor_id"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "replaces_id",
          "logical_id",
          "operator_actor_id"
        ],
        "target": "crest.travel_legs",
        "targetColumns": [
          "business_id",
          "id",
          "logical_id",
          "operator_actor_id"
        ]
      }
    ]
  },
  "work_scope_outcomes": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "assigned_part_id": {
        "type": "uuid",
        "nullable": false
      },
      "completion_part_id": {
        "type": "uuid",
        "nullable": false
      },
      "partition_id": {
        "type": "uuid",
        "nullable": false
      },
      "outcome": {
        "type": "text",
        "nullable": false
      },
      "scope_description": {
        "type": "text",
        "nullable": false
      },
      "completed_cents": {
        "type": "bigint",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "assigned_part_id"
        ],
        "target": "crest.allocation_plan_parts",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "completion_part_id"
        ],
        "target": "crest.allocation_plan_parts",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  },
  "message_templates": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "purpose": {
        "type": "text",
        "nullable": false
      },
      "sequence": {
        "type": "bigint",
        "nullable": false
      },
      "body_template": {
        "type": "text",
        "nullable": false
      },
      "active": {
        "type": "boolean",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  },
  "review_requests": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "customer_id": {
        "type": "uuid",
        "nullable": false
      },
      "is_primary": {
        "type": "boolean",
        "nullable": false
      },
      "message_id": {
        "type": "uuid",
        "nullable": true
      },
      "state": {
        "type": "text",
        "nullable": false
      },
      "suppression_reason": {
        "type": "text",
        "nullable": true
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "additional_request_reason": {
        "type": "text",
        "nullable": true
      },
      "duplicate_count": {
        "type": "bigint",
        "nullable": false
      },
      "customer_version": {
        "type": "bigint",
        "nullable": false
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      },
      "recipient_snapshot": {
        "type": "jsonb",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "message_id",
          "job_id"
        ],
        "target": "crest.messages",
        "targetColumns": [
          "business_id",
          "id",
          "job_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id",
          "customer_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id",
          "customer_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  },
  "messages": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "customer_id": {
        "type": "uuid",
        "nullable": false
      },
      "request_id": {
        "type": "uuid",
        "nullable": false
      },
      "template_version_id": {
        "type": "uuid",
        "nullable": false
      },
      "purpose": {
        "type": "text",
        "nullable": false
      },
      "state": {
        "type": "text",
        "nullable": false
      },
      "channel": {
        "type": "text",
        "nullable": false
      },
      "recipient_snapshot": {
        "type": "jsonb",
        "nullable": false
      },
      "body_snapshot": {
        "type": "text",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id",
          "customer_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id",
          "customer_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "request_id",
          "job_id"
        ],
        "target": "crest.review_requests",
        "targetColumns": [
          "business_id",
          "id",
          "job_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "template_version_id"
        ],
        "target": "crest.message_templates",
        "targetColumns": [
          "business_id",
          "id"
        ]
      }
    ]
  },
  "message_events": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "message_id": {
        "type": "uuid",
        "nullable": false
      },
      "kind": {
        "type": "text",
        "nullable": false
      },
      "effective_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "message_id",
          "job_id"
        ],
        "target": "crest.messages",
        "targetColumns": [
          "business_id",
          "id",
          "job_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  },
  "review_request_encounters": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "request_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_encounter_id": {
        "type": "uuid",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_encounter_id"
        ],
        "target": "crest.job_encounters",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "request_id",
          "job_id"
        ],
        "target": "crest.review_requests",
        "targetColumns": [
          "business_id",
          "id",
          "job_id"
        ]
      }
    ]
  },
  "job_finalization_tasks": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "kind": {
        "type": "text",
        "nullable": false
      },
      "state": {
        "type": "text",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  },
  "mileage_evidence": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "leg_id": {
        "type": "uuid",
        "nullable": false
      },
      "leg_version_id": {
        "type": "uuid",
        "nullable": false
      },
      "operator_actor_id": {
        "type": "uuid",
        "nullable": false
      },
      "sequence": {
        "type": "bigint",
        "nullable": false
      },
      "replaces_id": {
        "type": "uuid",
        "nullable": true
      },
      "source": {
        "type": "text",
        "nullable": false
      },
      "movement_kind": {
        "type": "text",
        "nullable": false
      },
      "actual_miles": {
        "type": "numeric(14,4)",
        "nullable": true
      },
      "estimate_miles": {
        "type": "numeric(14,4)",
        "nullable": true
      },
      "estimate_source": {
        "type": "text",
        "nullable": true
      },
      "odometer_start": {
        "type": "numeric(14,4)",
        "nullable": true
      },
      "odometer_end": {
        "type": "numeric(14,4)",
        "nullable": true
      },
      "allocation_state": {
        "type": "text",
        "nullable": false
      },
      "notes": {
        "type": "text",
        "nullable": true
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "confirmed_at": {
        "type": "timestamp with time zone",
        "nullable": true
      },
      "confirmed_by": {
        "type": "uuid",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "confirmed_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "leg_version_id",
          "leg_id",
          "operator_actor_id"
        ],
        "target": "crest.travel_legs",
        "targetColumns": [
          "business_id",
          "id",
          "logical_id",
          "operator_actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "replaces_id",
          "leg_id"
        ],
        "target": "crest.mileage_evidence",
        "targetColumns": [
          "business_id",
          "id",
          "leg_id"
        ]
      }
    ]
  },
  "leg_job_allocations": {
    "fields": {
      "id": {
        "type": "uuid",
        "nullable": false
      },
      "business_id": {
        "type": "uuid",
        "nullable": false
      },
      "evidence_id": {
        "type": "uuid",
        "nullable": false
      },
      "leg_id": {
        "type": "uuid",
        "nullable": false
      },
      "job_id": {
        "type": "uuid",
        "nullable": false
      },
      "fraction": {
        "type": "numeric(12,8)",
        "nullable": false
      },
      "reason": {
        "type": "text",
        "nullable": true
      },
      "created_at": {
        "type": "timestamp with time zone",
        "nullable": false
      },
      "created_by": {
        "type": "uuid",
        "nullable": false
      },
      "operation_id": {
        "type": "uuid",
        "nullable": false
      },
      "origin": {
        "type": "text",
        "nullable": false
      }
    },
    "foreignKeys": [
      {
        "columns": [
          "business_id",
          "created_by"
        ],
        "target": "crest.memberships",
        "targetColumns": [
          "business_id",
          "actor_id"
        ]
      },
      {
        "columns": [
          "business_id",
          "evidence_id",
          "leg_id"
        ],
        "target": "crest.mileage_evidence",
        "targetColumns": [
          "business_id",
          "id",
          "leg_id"
        ]
      },
      {
        "columns": [
          "business_id"
        ],
        "target": "crest.businesses",
        "targetColumns": [
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "job_id"
        ],
        "target": "crest.jobs",
        "targetColumns": [
          "business_id",
          "id"
        ]
      },
      {
        "columns": [
          "business_id",
          "operation_id",
          "created_by"
        ],
        "target": "crest_private.operations",
        "targetColumns": [
          "business_id",
          "operation_id",
          "actor_id"
        ]
      }
    ]
  }
} as const;
export type FieldSourceGroup=keyof typeof fieldSourceSchema;
export const fieldSourceGroups=Object.freeze(Object.keys(fieldSourceSchema) as FieldSourceGroup[]);
