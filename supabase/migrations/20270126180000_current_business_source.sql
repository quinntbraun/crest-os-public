-- Fixed current business-row export. No credentials, global/session sources,
-- caller-selected columns, arbitrary relations, writes or new runtime authority.
RESET ROLE;
CREATE ROLE crest_business_source_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_business_source_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_business_source_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_configuration_export_context(uuid) TO crest_business_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.business_source_dictionary_v1()
RETURNS TABLE(source_name text,fields text[],business_column text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 VALUES
 ('crest.businesses',ARRAY['id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'id'),
 ('crest.memberships',ARRAY['id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.audit_events',ARRAY['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash'],'business_id'),
 ('crest_private.business_recovery_authorities',ARRAY['id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.operations',ARRAY['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id'],'business_id'),
 ('crest.customers',ARRAY['id','business_id','display_name','phone_raw','phone_normalized','email_raw','email_normalized','contact_preference','outreach_opt_out','notes','customer_since','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.addresses',ARRAY['id','business_id','customer_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.vehicles',ARRAY['id','business_id','label','year','make','model','color','vin_raw','vin_normalized','plate','kind','notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.customer_vehicles',ARRAY['id','business_id','customer_id','vehicle_id','valid_from','valid_to','relationship','is_billing','evidence','close_reason','closed_at','closed_by','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.lead_sources',ARRAY['id','business_id','label','label_normalized','kind','active','referral_customer_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.leads',ARRAY['id','business_id','label','customer_id','source_id','source_snapshot','referral_text','phone_raw','phone_normalized','email_raw','email_normalized','requested_scope','availability','estimated_cents','state','follow_up_at','lost_reason','notes','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.lead_events',ARRAY['id','business_id','lead_id','lead_version','from_state','to_state','reason','effective_at','quote_send_id','acceptance_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.lead_vehicles',ARRAY['id','business_id','lead_id','vehicle_id','reported_vehicle','requested_services','condition_notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.lead_addresses',ARRAY['id','business_id','lead_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.lead_conversions',ARRAY['id','business_id','lead_id','customer_id','expected_lead_version','lead_version','customer_version','lead_before_audit_id','lead_audit_id','customer_audit_id','lead_child_operation_id','customer_child_operation_id','request','converted_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.conversion_links',ARRAY['id','business_id','conversion_id','lead_id','lead_vehicle_id','vehicle_id','lead_address_id','address_id','source_version','target_version','source_audit_id','target_audit_id','target_child_operation_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_jobs',ARRAY['id','business_id','actor_id','profile','app_release_id','source_schema_version','recovery_epoch','request_operation_id','state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_job_attempts',ARRAY['id','business_id','export_job_id','attempt_no','recovery_epoch','leased_at','lease_until','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_job_snapshots',ARRAY['generation_id','business_id','export_job_id','lease_id','actor_id','recovery_epoch','app_release_id','source_schema_version','observed_at','plan_sha256','request_sha256','request_text','file_count','total_bytes','manifest_sha256','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_part_intents',ARRAY['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','ordinal','file_name','content_type','object_key','key_id','plaintext_bytes','plaintext_sha256','ciphertext_bytes','ciphertext_sha256','request_sha256','request_text','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_part_verifications',ARRAY['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','request_sha256','request_text','verified_at','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest_private.export_job_completions',ARRAY['business_id','generation_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','expected_version','request_sha256','request_text','file_count','total_bytes','manifest_sha256','completed_at','expires_at','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.services',ARRAY['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.service_versions',ARRAY['id','business_id','service_id','sequence','name','inclusions','exclusions','internal_guidance','range_low_cents','range_high_cents','estimated_seconds','created_at','created_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.quote_families',ARRAY['id','business_id','lead_id','customer_id','current_revision_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.quote_revisions',ARRAY['id','business_id','family_id','sequence','kind','state','version','content_version','customer_safe_snapshot','internal_snapshot','canonical_content','content_hash','total_cents','expiry_at','timezone','tax_readiness','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id','parent_agreement_id'],'business_id'),
 ('crest.quote_items',ARRAY['id','business_id','revision_id','stable_line_key','active','position','vehicle_id','job_wide','service_version_id','gross_cents','line_discount','document_discount_eligible','line_discount_cents','allocated_discount_cents','final_cents','complimentary_reason','customer_snapshot','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id','assessment_id','category_override_note'],'business_id'),
 ('crest.condition_assessments',ARRAY['id','business_id','vehicle_id','condition_class','source','assessed_at','notes','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.quote_approvals',ARRAY['id','business_id','family_id','revision_id','approved_content_version','approved_content_hash','actor_id','reviewed_at','extreme_acknowledged','template_version','customer_representation','presentation_text','presentation_hash','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.appointment_hold_versions',ARRAY['id','business_id','hold_id','sequence','replaces_sequence','customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.quote_family_commercial_state',ARRAY['id','business_id','family_id','active_offer_id','initial_acceptance_id','current_agreement_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.quote_sends',ARRAY['id','business_id','family_id','revision_id','approval_id','channel','recipient_snapshot','confirmed_at','evidence_note','presentation_hash','replaces_revision_id','request','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id','lead_id'],'business_id'),
 ('crest.quote_acceptances',ARRAY['id','business_id','family_id','revision_id','send_id','customer_id','lead_id','conversion_id','counterparty_snapshot','content_hash','channel','confirmation_effective_at','recorded_at','evidence_note','request','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id','kind'],'business_id'),
 ('crest.agreements',ARRAY['id','business_id','family_id','acceptance_id','customer_id','version_no','parent_agreement_id','total_cents','signed_delta_cents','customer_snapshot','effective_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.scope_entitlements',ARRAY['id','business_id','agreement_family_id','stable_line_key','initial_quote_item_id','vehicle_id','job_wide','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.entitlement_versions',ARRAY['id','business_id','family_id','entitlement_id','agreement_id','authorized_cents','scope_snapshot','source_quote_item_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.scope_allocations',ARRAY['id','business_id','entitlement_id','agreement_id','entitlement_version_id','job_id','amount_cents','gross_inclusive_cents','discount_inclusive_cents','stable_partition_id','scope_description','scope_snapshot','allocation_state','replaces_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],'business_id'),
 ('crest.expense_revisions',ARRAY['business_id','expense_id','revision','operation_id','actor_id','recorded_at','payload'],'business_id'),
 ('crest.expense_receipt_revisions',ARRAY['business_id','receipt_id','revision','expense_id','expense_revision','operation_id','actor_id','recorded_at','reservation','candidate'],'business_id'),
 ('crest.fulfillment_mode_versions',ARRAY['id','business_id','sequence','replaces_sequence','mobile_enabled','dropoff_enabled','pickup_return_enabled','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.jobs',ARRAY['id','business_id','customer_id','operator_actor_id','fulfillment_mode','mode_version_id','work_address_id','work_location_snapshot','state','current_appointment_id','first_work_at','completed_at','completion_outcome','version','updated_at','updated_by','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.job_vehicles',ARRAY['id','business_id','job_id','vehicle_id','customer_vehicle_id','vehicle_snapshot','customer_snapshot','pickup_address_id','return_address_id','pickup_location_snapshot','return_location_snapshot','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.job_encounters',ARRAY['id','business_id','job_id','customer_id','family_id','agreement_id','encounter_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.appointments',ARRAY['id','business_id','job_id','sequence','replaces_id','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','confirmation_state','customer_confirmation','contact_snapshot','unknown_travel_reviewed','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.operator_controls',ARRAY['id','business_id','operator_actor_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.schedule_reservations',ARRAY['id','business_id','job_id','appointment_id','operator_actor_id','blocked_interval','unknown_travel','override_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.schedule_overrides',ARRAY['id','business_id','job_id','appointment_id','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.schedule_override_conflicts',ARRAY['id','business_id','override_id','conflicting_appointment_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.allocation_plan_versions',ARRAY['id','business_id','source_allocation_id','sequence','replaces_id','reason','created_at','created_by','operation_id','origin','entitlement_version_id','authorization_state'],'business_id'),
 ('crest.allocation_plan_parts',ARRAY['id','business_id','plan_id','stable_partition_id','job_id','allocation_state','gross_inclusive_cents','discount_inclusive_cents','amount_cents','scope_description','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.job_events',ARRAY['id','business_id','job_id','sequence','from_state','to_state','effective_at','reason','evidence','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.work_intervals',ARRAY['id','business_id','logical_id','sequence','replaces_id','job_id','operator_actor_id','kind','started_at','ended_at','pause_reason','change_kind','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.travel_legs',ARRAY['id','business_id','logical_id','sequence','replaces_id','operator_actor_id','driven_vehicle_id','job_context_id','purpose','origin_snapshot','destination_snapshot','departed_at','arrived_at','state','eta_at','eta_source','eta_calculated_at','notes','change_kind','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.work_scope_outcomes',ARRAY['id','business_id','job_id','assigned_part_id','completion_part_id','partition_id','outcome','scope_description','completed_cents','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.message_templates',ARRAY['id','business_id','purpose','sequence','body_template','active','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.review_requests',ARRAY['id','business_id','job_id','customer_id','is_primary','message_id','state','suppression_reason','reason','additional_request_reason','duplicate_count','customer_version','created_at','created_by','operation_id','origin','recipient_snapshot'],'business_id'),
 ('crest.messages',ARRAY['id','business_id','job_id','customer_id','request_id','template_version_id','purpose','state','channel','recipient_snapshot','body_snapshot','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.message_events',ARRAY['id','business_id','job_id','message_id','kind','effective_at','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.review_request_encounters',ARRAY['id','business_id','job_id','request_id','job_encounter_id','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.job_finalization_tasks',ARRAY['id','business_id','job_id','kind','state','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.mileage_evidence',ARRAY['id','business_id','leg_id','leg_version_id','operator_actor_id','sequence','replaces_id','source','movement_kind','actual_miles','estimate_miles','estimate_source','odometer_start','odometer_end','allocation_state','notes','reason','confirmed_at','confirmed_by','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.leg_job_allocations',ARRAY['id','business_id','evidence_id','leg_id','job_id','fraction','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.operator_occupancy',ARRAY['id','business_id','source_kind','logical_id','operator_actor_id','job_id','work_interval_id','travel_leg_id','started_at','ended_at','occupied','work_span'],'business_id'),
 ('crest.follow_up_tasks',ARRAY['id','business_id','customer_id','vehicle_id','source_job_id','due_at','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.follow_up_task_events',ARRAY['id','business_id','task_id','version','prior_version','kind','snoozed_until','rebooking_job_id','reason','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.custody_authorization_configs',ARRAY['id','business_id','mode_version_id','acknowledgement_text','condition_photo_required'],'business_id'),
 ('crest.custody_cases',ARRAY['id','business_id','job_id','job_vehicle_id','vehicle_id','mode','version','state','current_event_id','authorization_config_id'],'business_id'),
 ('crest.custody_events',ARRAY['id','business_id','case_id','version','prior_version','action','effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','created_by','operation_id','origin','acknowledgement_confirmed','condition_photo_id'],'business_id'),
 ('crest.custody_photo_attempts',ARRAY['id','business_id','job_id','job_vehicle_id','vehicle_id','case_id','handoff_version','actor_id','recovery_epoch','dispatch_id','declared_type','byte_size','reserved_at'],'business_id'),
 ('crest.custody_photo_originals',ARRAY['business_id','photo_id','detected_type','byte_size','sha256','validation_version','width','height','display_width','display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height','verified_at'],'business_id'),
 ('crest_private.pickup_custody_policies',ARRAY['id','business_id','mode_version_id','sequence','replaces_sequence','reason','created_by','acknowledgement_text','condition_photo_required','recorded_at'],'business_id'),
 ('crest_private.pickup_job_policies',ARRAY['business_id','job_id','policy_id'],'business_id'),
 ('crest_private.pickup_custody_collections',ARRAY['id','business_id','job_id','job_vehicle_id','vehicle_id','pickup_leg_version_id','policy_id','effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','condition_photo_id','acknowledgement_confirmed','created_by','operation_id'],'business_id'),
 ('crest_private.pickup_photo_slots',ARRAY['business_id','photo_id','job_id','job_vehicle_id','collection_id','return_collection_id','arrival_version_id','policy_id','job_version','actor_id','recovery_epoch'],'business_id'),
 ('crest_private.vehicle_custody_claims',ARRAY['business_id','vehicle_id','dropoff_case_id','pickup_collection_id'],'business_id'),
 ('crest_private.pickup_custody_releases',ARRAY['id','business_id','collection_id','job_id','job_vehicle_id','vehicle_id','policy_id','return_leg_version_id','job_version','effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','condition_photo_id','acknowledgement_confirmed','created_by','operation_id'],'business_id'),
 ('crest_private.pickup_return_failures',ARRAY['id','business_id','collection_id','return_leg_version_id','job_version','reason','recorded_at','created_by','operation_id'],'business_id'),
 ('crest.accounts',ARRAY['id','business_id','code','account_type','normal_side','control_kind','report_role','currency','first_version','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.account_versions',ARRAY['id','business_id','account_id','version','previous_version','name','active','reason','audit_event_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.account_mapping_versions',ARRAY['id','business_id','purpose','version','previous_version','account_id','effective_from','reason','audit_event_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest_private.finance_controls',ARRAY['id','business_id','recovery_authority_id','created_at','created_by','origin'],'business_id'),
 ('crest.tax_profiles',ARRAY['id','business_id','jurisdiction','applicability','service_id','scope_key','version','previous_version','effective_from','treatment','rate','verification_evidence','reason','synthetic','audit_event_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.money_channel_versions',ARRAY['id','business_id','channel_id','version','previous_version','effective_from','account_id','owner_actor_id','kind','ownership_scope','provider_namespace','masked_suffix','label','ownership_evidence','opening_state','opening_on','opening_cents','opening_evidence','active','reason','audit_event_id','created_at','created_by','operation_id','origin'],'business_id'),
 ('crest.invoice_draft_revisions',ARRAY['id','business_id','draft_id','revision','previous_revision','job_id','customer_id','due_on','selected_outcomes','retained_lines','state','reason','created_at','created_by','operation_id','audit_event_id','origin'],'business_id'),
 ('crest.accounting_periods',ARRAY['id','business_id','starts_on','month_start','through_on','time_zone','opening_boundary','created_by','operation_id','created_at'],'business_id'),
 ('crest.accounting_period_locks',ARRAY['id','business_id','period_id','generation','previous_generation','state','evidence_ref','created_by','operation_id','created_at'],'business_id'),
 ('crest.invoice_series',ARRAY['id','business_id','label','recovery_epoch','kind','incident_id','approval_reason','created_by','operation_id','created_at'],'business_id'),
 ('crest.invoice_number_reservations',ARRAY['id','business_id','full_number','series_id','number_sequence','issued_source_id','incident_id','external_evidence','recovery_epoch','created_by','operation_id','created_at'],'business_id'),
 ('crest.tax_payable_mapping_versions',ARRAY['id','business_id','jurisdiction','version','previous_version','account_id','effective_from','reason','audit_event_id','created_at','created_by','operation_id'],'business_id'),
 ('crest.invoice_exemption_evidence',ARRAY['id','business_id','draft_id','draft_revision','outcome_id','customer_id','jurisdiction','profile_id','version','previous_version','valid_from','valid_through','evidence_reference','reason','audit_event_id','created_at','created_by','operation_id'],'business_id'),
 ('crest.invoices',ARRAY['id','business_id','draft_id','draft_revision','job_id','customer_id','reservation_id','invoice_number','issued_on','due_on','time_zone','customer_snapshot','location_snapshot','total_cents','currency','created_at','created_by','operation_id'],'business_id'),
 ('crest.invoice_items',ARRAY['id','business_id','invoice_id','position','outcome_id','completion_part_id','partition_id','agreement_id','entitlement_version_id','service_version_id','tax_profile_id','exemption_evidence_id','gross_inclusive_cents','discount_inclusive_cents','gross_net_cents','discount_net_cents','net_cents','tax_cents','total_cents','description','created_at','created_by','operation_id'],'business_id'),
 ('crest.billing_consumptions',ARRAY['id','business_id','invoice_item_id','partition_id','consumed_cents','created_at','created_by','operation_id'],'business_id'),
 ('crest.atomic_finance_groups',ARRAY['id','business_id','commit_sequence','recovery_epoch','created_by','operation_id','created_at'],'business_id'),
 ('crest.financial_events',ARRAY['id','business_id','group_id','event_sequence','invoice_id','period_id','period_generation','reopened_generation','effective_on','time_zone','template','template_version','zero_effect_reason','posted_at','payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id','refund_transfer_adjustment_id','collection_failure_recredit_id','collection_failure_settlement_id','supplier_payable_id','supplier_payable_settlement_id'],'business_id'),
 ('crest.receivable_items',ARRAY['id','business_id','invoice_id','account_id','customer_id','original_cents','due_on'],'business_id'),
 ('crest.invoice_tax_payable_movements',ARRAY['id','business_id','event_id','invoice_item_id','tax_profile_id','mapping_id','account_id','jurisdiction','cents'],'business_id'),
 ('crest.journal_entries',ARRAY['id','business_id','event_id','entry_sequence'],'business_id'),
 ('crest.journal_lines',ARRAY['id','business_id','entry_id','invoice_item_id','receivable_id','account_id','fixed_mapping_id','tax_payable_movement_id','purpose','debit_cents','credit_cents','money_movement_id','allocation_event_id','unapplication_id','fund_lot_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id','collection_failure_component_id','refund_transfer_adjustment_id','collection_failure_recredit_id','collection_failure_settlement_id','collection_failure_settlement_component_id','supplier_payable_id','supplier_payable_settlement_id'],'business_id'),
 ('crest.external_money_evidence',ARRAY['id','business_id','provider_namespace','external_account_id','id_namespace','external_id','raw_reference','normalization_rule','confirmed_on','signed_cents','currency'],'business_id'),
 ('crest.payments',ARRAY['id','business_id','customer_id','channel_version_id','account_id','actual_on','gross_cents','confirmation','distinct_reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.money_movements',ARRAY['id','business_id','event_id','account_id','evidence_id','signed_cents'],'business_id'),
 ('crest.funding_origins',ARRAY['id','business_id','payment_id','customer_id','cents','currency'],'business_id'),
 ('crest.funding_partitions',ARRAY['id','business_id','origin_id','position','first_cent','last_cent'],'business_id'),
 ('crest.allocation_events',ARRAY['id','business_id','event_id','partition_id','receivable_id','cents'],'business_id'),
 ('crest.posted_expenses',ARRAY['id','business_id','expense_id','expense_revision','incurred_on','paid_on','gross_cents','purchase_tax_cents','purchase_tax_treatment','mapping_id','expense_account_id','channel_version_id','money_account_id','evidence_id','receipt_id','receipt_revision','missing_receipt_reason','unknown_vendor_reason','review_reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.allocation_unapplications',ARRAY['id','business_id','allocation_id','first_cent','last_cent','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.customer_fund_lots',ARRAY['id','business_id','unapplication_id','origin_id','parent_partition_id','customer_id','account_id','mapping_id','original_cents','receipt_event_id','receipt_tip_event_id','collection_failure_recredit_event_id','collection_failure_settlement_component_id'],'business_id'),
 ('crest.customer_fund_applications',ARRAY['id','business_id','fund_lot_id','receivable_id','first_cent','last_cent','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.tip_realizations',ARRAY['id','business_id','fund_lot_id','first_cent','last_cent','inclusive_cents','net_cents','tax_cents','jurisdiction','tax_profile_id','revenue_mapping_id','revenue_account_id','tax_mapping_id','tax_account_id','customer_intent_evidence','reason','operation_id','created_by','created_at','restored_settlement_component_id'],'business_id'),
 ('crest.fund_lot_range_consumptions',ARRAY['id','business_id','fund_lot_id','first_cent','last_cent','fund_application_id','tip_realization_id','service_refund_id','excess_return_id','collection_failure_component_id'],'business_id'),
 ('crest.invoice_credits',ARRAY['id','business_id','invoice_item_id','receivable_id','first_cent','last_cent','inclusive_cents','net_cents','tax_cents','discount_cents','returns_cents','returns_mapping_id','returns_account_id','tax_account_id','original_tax_movement_id','discount_mapping_id','discount_account_id','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.paired_invoice_credit_releases',ARRAY['id','business_id','invoice_credit_id','unapplication_id','operation_id','actor_id','reviewed_ar_cents'],'business_id'),
 ('crest.service_credit_refunds',ARRAY['id','business_id','pair_id','fund_lot_id','first_cent','last_cent','cents','channel_version_id','account_id','evidence_id','actual_on','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.google_calendar_consents',ARRAY['id','business_id','destination_id','generation','previous_generation','recovery_epoch','state','client_name','service_label','work_address','created_by','operation_id','created_at'],'business_id'),
 ('crest.google_calendar_destinations',ARRAY['id','business_id','provider_calendar_id','created_by','operation_id','created_at'],'business_id'),
 ('crest.google_calendar_disconnects',ARRAY['id','business_id','destination_id','recovery_epoch','disconnected_generation','prior_generation','fenced_at','drain_until','actor_id','operation_id'],'business_id'),
 ('crest.google_calendar_dispatch_leases',ARRAY['id','business_id','outbox_id','attempt_no','mode','leased_at','lease_until'],'business_id'),
 ('crest.google_calendar_dispatch_results',ARRAY['id','business_id','lease_id','outcome','provider_etag','source_current','recorded_at','retry_at'],'business_id'),
 ('crest.google_calendar_dispatch_sends',ARRAY['id','business_id','lease_id','action','request_sha256','prior_etag','recorded_at'],'business_id'),
 ('crest.google_calendar_mappings',ARRAY['id','business_id','destination_id','job_id','event_uuid','correlation_marker','created_by','operation_id','created_at'],'business_id'),
 ('crest.google_calendar_outbox',ARRAY['id','business_id','destination_id','connection_generation','recovery_epoch','job_id','appointment_id','appointment_sequence','mapping_id','action','created_by','operation_id','created_at'],'business_id'),
 ('crest.google_calendar_request_admissions',ARRAY['id','business_id','lease_id','setup_attempt_id','creation_attempt_id','kind','admitted_at'],'business_id'),
 ('crest.google_calendar_revocation_events',ARRAY['business_id','disconnect_id','attempt_id','phase','admission_phase','recorded_at','deadline','actor_id'],'business_id'),
 ('crest_private.google_calendar_code_exchanges',ARRAY['business_id','attempt_id','app_session_id','actor_id','recovery_epoch','client_id','generation','destination_id','admitted_at','deadline'],'business_id'),
 ('crest_private.google_calendar_creation_intents',ARRAY['business_id','attempt_id','actor_id','app_session_id','recovery_epoch','client_id','correlation_marker','confirmed_at'],'business_id'),
 ('crest_private.google_calendar_creation_results',ARRAY['business_id','attempt_id','recorded_at','outcome','provider_calendar_id'],'business_id'),
 ('crest_private.google_calendar_credentials',ARRAY['id','business_id','destination_id','connection_generation','recovery_epoch','client_id','scope','version','source_exchange','created_at','updated_at'],'business_id'),
 ('crest_private.google_calendar_destination_reviews',ARRAY['id','business_id','destination_id','app_session_id','actor_id','recovery_epoch','generation','client_id','provider_calendar_id','reviewed_at','expires_at'],'business_id'),
 ('crest_private.google_calendar_destination_verifications',ARRAY['business_id','attempt_id','review_id','destination_id','verified_at'],'business_id'),
 ('crest_private.google_calendar_initial_consent_reviews',ARRAY['business_id','id','destination_id','credential_id','actor_id','app_session_id','recovery_epoch','client_id','client_name','service_label','work_address','payload_version','reviewed_at','expires_at'],'business_id'),
 ('crest_private.google_calendar_refresh_claims',ARRAY['id','business_id','credential_id','credential_version','admitted_at','deadline'],'business_id'),
 ('crest_private.google_calendar_refresh_results',ARRAY['business_id','claim_id','outcome','recorded_at'],'business_id'),
 ('crest.excess_receipt_returns',ARRAY['id','business_id','receipt_event_id','fund_lot_id','first_cent','last_cent','cents','channel_version_id','account_id','evidence_id','actual_on','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.tip_returns',ARRAY['id','business_id','tip_realization_id','channel_version_id','account_id','evidence_id','actual_on','cents','net_cents','tax_cents','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.tip_realization_range_consumptions',ARRAY['id','business_id','tip_realization_id','tip_return_id','first_cent','last_cent','collection_failure_component_id'],'business_id'),
 ('crest.collection_failures',ARRAY['id','business_id','payment_id','original_event_id','kind','channel_version_id','money_account_id','evidence_id','effective_on','cents','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.collection_failure_components',ARRAY['id','business_id','collection_failure_id','payment_id','allocation_id','fund_application_id','fund_lot_id','tip_realization_id','first_cent','last_cent','root_first_cent','root_last_cent','net_cents','tax_cents','restored_tip_generation_id'],'business_id'),
 ('crest.refund_transfer_adjustments',ARRAY['id','business_id','kind','prior_event_id','original_event_id','fund_lot_id','channel_version_id','account_id','evidence_id','actual_on','cents','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.refund_transfer_adjustment_ranges',ARRAY['id','business_id','adjustment_id','prior_event_id','first_cent','last_cent'],'business_id'),
 ('crest.refund_transfer_embedded_fees',ARRAY['id','business_id','adjustment_id','mapping_id','fee_account_id','net_cents','cents','confirmation','component_evidence_id'],'business_id'),
 ('crest.collection_failure_recredits',ARRAY['id','business_id','failure_id','failure_component_id','customer_id','channel_version_id','money_account_id','evidence_id','actual_on','first_cent','last_cent','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.collection_failure_settlements',ARRAY['id','business_id','failure_id','customer_id','channel_version_id','money_account_id','evidence_id','actual_on','cents','confirmation','reason','operation_id','created_by','created_at'],'business_id'),
 ('crest.collection_failure_settlement_components',ARRAY['id','business_id','settlement_id','failure_id','failure_component_id','parent_partition_id','first_cent','last_cent','receivable_id','original_tip_realization_id'],'business_id'),
 ('crest.collection_failure_recredit_claims',ARRAY['id','business_id','failure_component_id','first_cent','last_cent','legacy_recredit_id','settlement_component_id'],'business_id'),
 ('crest.opening_worksheet_revisions',ARRAY['id','business_id','revision','prior_revision','cutover_on','cutover_at','time_zone','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id'),
 ('crest.statement_imports',ARRAY['id','business_id','account_id','channel_version_id','starts_on','ends_on','opening_cents','closing_cents','file_sha256','date_convention','completeness_evidence','row_count','signed_rows_cents','rows_sha256','statement_difference_cents','operation_id','created_by','created_at'],'business_id'),
 ('crest.statement_import_rows',ARRAY['business_id','statement_id','id','statement_on','signed_cents'],'business_id'),
 ('crest.opening_receivable_schedule_revisions',ARRAY['id','business_id','worksheet_revision_id','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id'),
 ('crest.statement_match_draft_revisions',ARRAY['business_id','statement_id','revision','previous_revision','operation_id','audit_id','recorded_by','recorded_at','movement_from_on','reason','allocations'],'business_id'),
 ('crest.supplier_bill_draft_revisions',ARRAY['business_id','bill_id','revision','previous_revision','operation_id','actor_id','recorded_at','payload'],'business_id'),
 ('crest.supplier_bill_original_intents',ARRAY['id','business_id','bill_id','bill_revision','document_reference','recovery_epoch','media_type','byte_size','dispatch_id','operation_id','created_by','reserved_at'],'business_id'),
 ('crest.supplier_bill_originals',ARRAY['id','business_id','bill_id','bill_revision','document_reference','file_sha256','byte_size','media_type','object_key','verified_at','candidate','operation_id','created_by'],'business_id'),
 ('crest.supplier_payables',ARRAY['id','business_id','bill_id','bill_revision','original_id','payable_account_id','payable_mapping_id','gross_cents','review','duplicate_payable_ids','distinct_reason','operation_id','created_by','recorded_at'],'business_id'),
 ('crest.supplier_payable_settlements',ARRAY['id','business_id','payable_id','operation_id','created_by','channel_version_id','evidence_id','actual_on','paid_cents','remaining_before_cents','confirmation','recorded_at'],'business_id'),
 ('crest.legacy_contact_batches',ARRAY['id','business_id','source_label','original_sha256','mapping_version','mapping','mapping_sha256','rows_sha256','row_count','rejected_count','operation_id','created_by','created_at'],'business_id'),
 ('crest.legacy_contact_batch_rows',ARRAY['business_id','batch_id','source_row','candidate','fingerprint'],'business_id'),
 ('crest.legacy_contact_decision_sources',ARRAY['business_id','batch_id','source_namespace','first_operation_id','created_by'],'business_id'),
 ('crest.legacy_contact_decisions',ARRAY['id','business_id','batch_id','source_row','source_namespace','row_fingerprint','revision','customer_action','customer_id','customer_version','vehicle_action','vehicle_id','vehicle_version','operation_id','created_by','created_at'],'business_id'),
 ('crest.legacy_contact_approvals',ARRAY['id','business_id','batch_id','source_namespace','evidence_sha256','original_sha256','mapping_sha256','rows_sha256','decisions_sha256','row_count','skipped_rows','operation_id','approved_by','approved_at'],'business_id'),
 ('crest.legacy_contact_external_identities',ARRAY['business_id','source_namespace','entity_kind','external_id','customer_id','vehicle_id','first_batch_id','first_evidence_sha256','first_source_row','first_decision_revision','first_apply_operation_id','created_by','created_at'],'business_id'),
 ('crest.legacy_contact_applications',ARRAY['business_id','batch_id','evidence_sha256','operation_id','applied_by'],'business_id'),
 ('crest.legacy_contact_application_rows',ARRAY['business_id','batch_id','source_row','decision_revision','customer_action','customer_id','customer_version','vehicle_action','vehicle_id','vehicle_version'],'business_id'),
 ('crest_private.legacy_contact_apply_requests',ARRAY['business_id','operation_id','batch_id','evidence_sha256','requested_by','security_epoch','recovery_epoch','requested_at','outcome','completed_at','attempt_count','next_attempt_at','lease_id','lease_expires_at'],'business_id'),
 ('crest_private.google_calendar_creation_abandonments',ARRAY['business_id','attempt_id','actor_id','app_session_id','recovery_epoch','operation_id','abandoned_at'],'business_id'),
 ('crest_private.google_calendar_account_bindings',ARRAY['business_id','destination_id','client_id','provider_issuer','credential_id','source_attempt','recovery_epoch','actor_id','bound_at'],'business_id'),
 ('crest_private.google_calendar_reconnection_stagings',ARRAY['business_id','attempt_id','destination_id','credential_id','generation','recovery_epoch','actor_id','app_session_id','provider_issuer','staged_at'],'business_id');
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.business_source_dictionary_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.business_source_dictionary_v1() TO crest_business_source_owner;
DO $grant$
DECLARE d record; source_oid oid; projection text;
BEGIN
 FOR d IN SELECT * FROM crest_private.business_source_dictionary_v1() LOOP
  source_oid:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=source_oid AND relkind='r'
   AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=source_oid AND i.indisprimary
    AND NOT EXISTS(SELECT FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=source_oid AND a.attnum=k WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_business_source_owner',projection,source_oid::regclass);
  EXECUTE format('CREATE POLICY current_business_source_scope ON %s FOR SELECT TO crest_business_source_owner USING(%I=nullif(current_setting(''crest.business_source_business'',true),'''')::uuid)',source_oid::regclass,d.business_column);
 END LOOP;
END $grant$;
CREATE FUNCTION crest_commands.business_source_page_v1(requested_business uuid,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; source_oid oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; snapshot_value text; token text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF page_size IS NULL OR page_size<1 OR page_size>100 OR requested_business IS NULL
  OR (after_key IS NOT NULL AND (expected_snapshot IS NULL OR cardinality(after_key)<1 OR cardinality(after_key)>16 OR array_position(after_key,NULL) IS NOT NULL))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT * INTO d FROM crest_private.business_source_dictionary_v1() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.business.rows/1',requested_business,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_CHANGED'; END IF;
 source_oid:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY k.position) INTO pk FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=source_oid AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype
  THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field)
  ELSE format('t.%I::text',field) END),',' ORDER BY position),
  jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types
  FROM unnest(d.fields) WITH ORDINALITY f(field,position) JOIN pg_attribute a ON a.attrelid=source_oid AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY f(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM (SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.%I=$1 AND ($2::text[] IS NULL OR (%s COLLATE "C")>($2::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $3) bounded',key_sql,projection,source_oid::regclass,d.business_column,key_sql,key_sql)
  INTO data,keys USING requested_business,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1); END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'source',requested_source,'snapshotToken',token,
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.business_source_page_v1(uuid,text,text,text[],integer) OWNER TO crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_commands.business_source_page_v1(uuid,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_source_page_v1(uuid,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_business_source_owner;
