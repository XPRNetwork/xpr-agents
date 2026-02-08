import {
  Validator,
  ValidatorRaw,
  Validation,
  ValidationRaw,
  ValidationConfig,
  Challenge,
  ValidatorListOptions,
  SubmitValidationData,
  TransactionResult,
  JsonRpc,
  ProtonSession,
  ValidationResult,
} from './types';
import {
  parseSpecializations,
  validationResultFromNumber,
  validationResultToNumber,
  disputeStatusFromNumber,
  safeParseInt,
} from './utils';

const DEFAULT_CONTRACT = 'agentvalid';

export class ValidationRegistry {
  private rpc: JsonRpc;
  private session: ProtonSession | null;
  private contract: string;

  constructor(rpc: JsonRpc, session?: ProtonSession, contract?: string) {
    this.rpc = rpc;
    this.session = session || null;
    this.contract = contract || DEFAULT_CONTRACT;
  }

  // ============== READ OPERATIONS ==============

  /**
   * Get a validator by account
   */
  async getValidator(account: string): Promise<Validator | null> {
    const result = await this.rpc.get_table_rows<ValidatorRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'validators',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseValidator(result.rows[0]);
  }

  /**
   * List all validators
   */
  async listValidators(options: ValidatorListOptions = {}): Promise<Validator[]> {
    const { limit = 100, active_only = true } = options;

    const result = await this.rpc.get_table_rows<ValidatorRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'validators',
      limit,
    });

    let validators = result.rows.map((row) => this.parseValidator(row));

    if (active_only) {
      validators = validators.filter((v) => v.active);
    }

    if (options.min_stake !== undefined) {
      validators = validators.filter((v) => v.stake >= options.min_stake!);
    }

    if (options.min_accuracy !== undefined) {
      validators = validators.filter((v) => v.accuracy_score >= options.min_accuracy!);
    }

    if (options.specialization) {
      validators = validators.filter((v) =>
        v.specializations.includes(options.specialization!)
      );
    }

    return validators;
  }

  /**
   * Get validation by ID
   */
  async getValidation(id: number): Promise<Validation | null> {
    const result = await this.rpc.get_table_rows<ValidationRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'validations',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseValidation(result.rows[0]);
  }

  /**
   * List validations for an agent
   */
  async listValidationsForAgent(agent: string, limit: number = 100): Promise<Validation[]> {
    const result = await this.rpc.get_table_rows<ValidationRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'validations',
      index_position: 2,
      key_type: 'i64',
      limit,
    });

    return result.rows
      .filter((row) => row.agent === agent)
      .map((row) => this.parseValidation(row));
  }

  /**
   * List validations by a validator
   */
  async listValidationsByValidator(
    validator: string,
    limit: number = 100
  ): Promise<Validation[]> {
    const result = await this.rpc.get_table_rows<ValidationRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'validations',
      index_position: 3,
      key_type: 'i64',
      limit,
    });

    return result.rows
      .filter((row) => row.validator === validator)
      .map((row) => this.parseValidation(row));
  }

  /**
   * Get challenge by ID
   */
  async getChallenge(id: number): Promise<Challenge | null> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      validation_id: string;
      challenger: string;
      reason: string;
      evidence_uri: string;
      stake: string;
      status: number;
      resolver: string;
      resolution_notes: string;
      created_at: string;
      resolved_at: string;
      funding_deadline: string;
      funded_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'challenges',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseChallenge(result.rows[0]);
  }

  /**
   * Get challenges for a validation
   */
  async getChallengesForValidation(validationId: number): Promise<Challenge[]> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      validation_id: string;
      challenger: string;
      reason: string;
      evidence_uri: string;
      stake: string;
      status: number;
      resolver: string;
      resolution_notes: string;
      created_at: string;
      resolved_at: string;
      funding_deadline: string;
      funded_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'challenges',
      index_position: 2,
      key_type: 'i64',
      limit: 100,
    });

    return result.rows
      .filter((row) => row.validation_id === String(validationId))
      .map((row) => this.parseChallenge(row));
  }

  // ============== WRITE OPERATIONS ==============

  /**
   * Register as a validator
   */
  async registerValidator(
    method: string,
    specializations: string[]
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'regval',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            method,
            specializations: JSON.stringify(specializations),
          },
        },
      ],
    });
  }

  /**
   * Update validator info
   */
  async updateValidator(
    method: string,
    specializations: string[]
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'updateval',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            method,
            specializations: JSON.stringify(specializations),
          },
        },
      ],
    });
  }

  /**
   * Stake XPR as validator
   */
  async stake(amount: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            from: this.session!.auth.actor,
            to: this.contract,
            quantity: amount,
            memo: 'stake',
          },
        },
      ],
    });
  }

  /**
   * Submit validation
   */
  async validate(data: SubmitValidationData): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'validate',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            validator: this.session!.auth.actor,
            agent: data.agent,
            job_hash: data.job_hash,
            result: validationResultToNumber(data.result),
            confidence: data.confidence,
            evidence_uri: data.evidence_uri || '',
          },
        },
      ],
    });
  }

  /**
   * Challenge a validation
   */
  async challenge(
    validationId: number,
    reason: string,
    evidenceUri?: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'challenge',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            challenger: this.session!.auth.actor,
            validation_id: validationId,
            reason,
            evidence_uri: evidenceUri || '',
          },
        },
      ],
    });
  }

  /**
   * Stake for a challenge
   */
  async stakeChallengeDeposit(
    challengeId: number,
    amount: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            from: this.session!.auth.actor,
            to: this.contract,
            quantity: amount,
            memo: `challenge:${challengeId}`,
          },
        },
      ],
    });
  }

  /**
   * Set validator active status
   */
  async setValidatorStatus(active: boolean): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'setvalstat',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            active,
          },
        },
      ],
    });
  }

  /**
   * Request to unstake validator funds (time-delayed).
   * Must be deactivated and have no pending challenges first.
   *
   * @param amount - Amount to unstake in smallest units
   */
  async unstake(amount: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'unstake',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            amount,
          },
        },
      ],
    });
  }

  /**
   * Withdraw unstaked validator funds (after delay period)
   *
   * @param unstakeId - The ID of the unstake request to withdraw
   */
  async withdraw(unstakeId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'withdraw',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            unstake_id: unstakeId,
          },
        },
      ],
    });
  }

  /**
   * Cancel an unfunded challenge (within grace period or after deadline)
   */
  async cancelChallenge(challengeId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'cancelchal',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            challenger: this.session!.auth.actor,
            challenge_id: challengeId,
          },
        },
      ],
    });
  }

  /**
   * Resolve a validation challenge (owner only)
   */
  async resolve(
    challengeId: number,
    upheld: boolean,
    resolutionNotes: string
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'resolve',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            resolver: this.session!.auth.actor,
            challenge_id: challengeId,
            upheld,
            resolution_notes: resolutionNotes,
          },
        },
      ],
    });
  }

  /**
   * Expire an unfunded challenge (permissionless cleanup)
   */
  async expireUnfundedChallenge(challengeId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'expireunfund',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            challenge_id: challengeId,
          },
        },
      ],
    });
  }

  /**
   * Expire a funded challenge that was not resolved within timeout (permissionless cleanup)
   */
  async expireFundedChallenge(challengeId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'expirefunded',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            challenge_id: challengeId,
          },
        },
      ],
    });
  }

  /**
   * Submit validation with fee in one transaction.
   *
   * @param data - Validation data
   * @param amount - The validation fee (e.g., "1.0000 XPR")
   */
  async validateWithFee(data: SubmitValidationData, amount: string): Promise<TransactionResult> {
    this.requireSession();

    const actor = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [{
            actor,
            permission: this.session!.auth.permission,
          }],
          data: {
            from: actor,
            to: this.contract,
            quantity: amount,
            memo: `valfee:${actor}`,
          },
        },
        {
          account: this.contract,
          name: 'validate',
          authorization: [{
            actor,
            permission: this.session!.auth.permission,
          }],
          data: {
            validator: actor,
            agent: data.agent,
            job_hash: data.job_hash,
            result: validationResultToNumber(data.result),
            confidence: data.confidence,
            evidence_uri: data.evidence_uri || '',
          },
        },
      ],
    });
  }

  /**
   * Clean up old validations (permissionless)
   */
  async cleanValidations(agent: string, maxAge: number, maxDelete: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cleanvals',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          agent,
          max_age: maxAge,
          max_delete: maxDelete,
        },
      }],
    });
  }

  /**
   * Clean up resolved challenges (permissionless)
   */
  async cleanChallenges(maxAge: number, maxDelete: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [{
        account: this.contract,
        name: 'cleanchals',
        authorization: [{
          actor: this.session!.auth.actor,
          permission: this.session!.auth.permission,
        }],
        data: {
          max_age: maxAge,
          max_delete: maxDelete,
        },
      }],
    });
  }

  /**
   * Get validation contract configuration
   */
  async getConfig(): Promise<ValidationConfig> {
    const result = await this.rpc.get_table_rows<{
      owner: string;
      core_contract: string;
      min_stake: string;
      challenge_stake: string;
      unstake_delay: string;
      challenge_window: string;
      slash_percent: string;
      dispute_period: string;
      funded_challenge_timeout: string;
      paused: number;
      validation_fee: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'config',
      limit: 1,
    });

    if (result.rows.length === 0) {
      throw new Error('Contract not initialized');
    }

    const row = result.rows[0];
    return {
      owner: row.owner,
      core_contract: row.core_contract,
      min_stake: safeParseInt(row.min_stake),
      challenge_stake: safeParseInt(row.challenge_stake),
      unstake_delay: safeParseInt(row.unstake_delay),
      challenge_window: safeParseInt(row.challenge_window),
      slash_percent: safeParseInt(row.slash_percent),
      dispute_period: safeParseInt(row.dispute_period),
      funded_challenge_timeout: safeParseInt(row.funded_challenge_timeout),
      paused: row.paused === 1,
      validation_fee: safeParseInt(row.validation_fee),
    };
  }

  // ============== HELPERS ==============

  private requireSession(): void {
    if (!this.session) {
      throw new Error('Session required for write operations');
    }
  }

  private parseValidator(raw: ValidatorRaw): Validator {
    return {
      account: raw.account,
      stake: safeParseInt(raw.stake),
      method: raw.method,
      specializations: parseSpecializations(raw.specializations),
      total_validations: safeParseInt(raw.total_validations),
      incorrect_validations: safeParseInt(raw.incorrect_validations),
      accuracy_score: safeParseInt(raw.accuracy_score),
      pending_challenges: safeParseInt(raw.pending_challenges),
      registered_at: safeParseInt(raw.registered_at),
      active: raw.active === 1,
    };
  }

  private parseValidation(raw: ValidationRaw): Validation {
    return {
      id: safeParseInt(raw.id),
      validator: raw.validator,
      agent: raw.agent,
      job_hash: raw.job_hash,
      result: validationResultFromNumber(raw.result),
      confidence: raw.confidence,
      evidence_uri: raw.evidence_uri,
      challenged: raw.challenged === 1,
      timestamp: safeParseInt(raw.timestamp),
    };
  }

  private parseChallenge(raw: {
    id: string;
    validation_id: string;
    challenger: string;
    reason: string;
    evidence_uri: string;
    stake: string;
    status: number;
    resolver: string;
    resolution_notes: string;
    created_at: string;
    resolved_at: string;
    funding_deadline: string;
    funded_at: string;
  }): Challenge {
    return {
      id: safeParseInt(raw.id),
      validation_id: safeParseInt(raw.validation_id),
      challenger: raw.challenger,
      reason: raw.reason,
      evidence_uri: raw.evidence_uri,
      stake: safeParseInt(raw.stake),
      status: disputeStatusFromNumber(raw.status),
      resolver: raw.resolver,
      resolution_notes: raw.resolution_notes,
      created_at: safeParseInt(raw.created_at),
      resolved_at: safeParseInt(raw.resolved_at),
      funding_deadline: safeParseInt(raw.funding_deadline),
      funded_at: safeParseInt(raw.funded_at),
    };
  }
}
