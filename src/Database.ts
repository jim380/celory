import { Pool } from "pg";
import { GroupCheckerResult, member } from "./GroupChecker";

export class DatabaseService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.initialize();
  }

  private async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "group" (
        id SERIAL PRIMARY KEY,
        name TEXT,
        address TEXT UNIQUE,
        is_eligible BOOLEAN,
        commission NUMERIC,
        last_slashed TEXT,
        domain TEXT,
        vote_signer TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS group_votes (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES "group"(id) ON DELETE CASCADE,
        total TEXT,
        active TEXT,
        pending TEXT,
        receivable TEXT,
        UNIQUE (group_id)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS validator (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES "group"(id) ON DELETE CASCADE,
        address TEXT UNIQUE,
        vote_signer TEXT,
        elected BOOLEAN,
        score TEXT
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS unsigned (
        id SERIAL PRIMARY KEY,
        block_num INTEGER,
        validator_id INTEGER REFERENCES validator(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  // TO-DO fetch validator info and populate all fields for the validator entry
  async upsertValidator(address: string): Promise<number> {
    const result = await this.pool.query(
      "INSERT INTO validator (address) VALUES ($1) ON CONFLICT (address) DO NOTHING RETURNING id",
      [address]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    } else {
      const selectResult = await this.pool.query(
        "SELECT id FROM validator WHERE address = $1",
        [address]
      );
      return selectResult.rows[0].id;
    }
  }

  async upsertGroup(result: GroupCheckerResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Check if the group data has changed
      const existingGroupQuery = `
        SELECT name, is_eligible, commission, last_slashed, domain, vote_signer
        FROM "group"
        WHERE address = $1
      `;
      const existingGroupResult = await client.query(existingGroupQuery, [
        result.address,
      ]);

      if (
        existingGroupResult.rows.length === 0 ||
        !this.isGroupDataEqual(existingGroupResult.rows[0], result)
      ) {
        const groupQuery = `
          INSERT INTO "group" (
            name, address, is_eligible, commission, last_slashed, domain, vote_signer
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (address) DO UPDATE SET
            name = EXCLUDED.name,
            is_eligible = EXCLUDED.is_eligible,
            commission = EXCLUDED.commission,
            last_slashed = EXCLUDED.last_slashed,
            domain = EXCLUDED.domain,
            vote_signer = EXCLUDED.vote_signer,
            created_at = NOW()
          RETURNING id
        `;
        const groupValues = [
          result.name,
          result.address,
          result.isEligible,
          result.commission,
          result.lastSlashed,
          result.domain,
          result.voteSigner,
        ];
        const groupResult = await client.query(groupQuery, groupValues);
        const groupId = groupResult.rows[0].id;

        // Check if the group_votes data has changed
        const existingVotesQuery = `
          SELECT total, active, pending, receivable
          FROM group_votes
          WHERE group_id = $1
        `;
        const existingVotesResult = await client.query(existingVotesQuery, [
          groupId,
        ]);

        if (
          existingVotesResult.rows.length === 0 ||
          !this.isVotesDataEqual(existingVotesResult.rows[0], result.votes)
        ) {
          const votesQuery = `
            INSERT INTO group_votes (group_id, total, active, pending, receivable)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (group_id) DO UPDATE SET
              total = EXCLUDED.total,
              active = EXCLUDED.active,
              pending = EXCLUDED.pending,
              receivable = EXCLUDED.receivable
          `;
          const votesValues = [
            groupId,
            result.votes.total,
            result.votes.active,
            result.votes.pending,
            result.votes.receivable,
          ];
          await client.query(votesQuery, votesValues);
        }

        // Delete existing validators for the group
        const deleteValidatorsQuery =
          "DELETE FROM validator WHERE group_id = $1";
        await client.query(deleteValidatorsQuery, [groupId]);

        // Insert or update validators
        const validatorsQuery = `
          INSERT INTO validator (group_id, address, vote_signer, elected, score)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (address) DO UPDATE SET
            vote_signer = EXCLUDED.vote_signer,
            elected = EXCLUDED.elected,
            score = EXCLUDED.score
        `;
        for (const member of result.members) {
          const existingValidatorQuery = `
            SELECT vote_signer, elected, score
            FROM validator
            WHERE address = $1
          `;
          const existingValidatorResult = await client.query(
            existingValidatorQuery,
            [member.address]
          );

          if (
            existingValidatorResult.rows.length === 0 ||
            !this.isValidatorDataEqual(existingValidatorResult.rows[0], member)
          ) {
            const validatorsValues = [
              groupId,
              member.address,
              member.voteSigner,
              member.elected,
              member.score,
            ];
            await client.query(validatorsQuery, validatorsValues);
          }
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getGroupInfo(addresses: string[]): Promise<GroupCheckerResult[]> {
    const results: GroupCheckerResult[] = [];

    for (const address of addresses) {
      const groupQuery = `
        SELECT id, name, address, is_eligible, commission, last_slashed, domain, vote_signer
        FROM "group"
        WHERE address = $1
      `;
      const groupResult = await this.pool.query(groupQuery, [address]);

      if (groupResult.rows.length === 0) {
        continue;
      }

      const group = groupResult.rows[0];

      const votesQuery = `
        SELECT total, active, pending, receivable
        FROM group_votes
        WHERE group_id = $1
      `;
      const votesResult = await this.pool.query(votesQuery, [group.id]);

      const membersQuery = `
        SELECT address, vote_signer, elected, score
        FROM validator
        WHERE group_id = $1
      `;
      const membersResult = await this.pool.query(membersQuery, [group.id]);

      const result: GroupCheckerResult = {
        name: group.name,
        address: group.address,
        isEligible: group.is_eligible,
        votes: votesResult.rows[0],
        members: membersResult.rows,
        commission: group.commission,
        lastSlashed: group.last_slashed,
        domain: group.domain,
        voteSigner: group.vote_signer,
      };

      results.push(result);
    }

    return results;
  }

  async getValidatorInfo(addresses: string[]): Promise<member[]> {
    const results: member[] = [];

    for (const address of addresses) {
      const validatorQuery = `
        SELECT id, group_id, address, vote_signer, elected, score
        FROM validator
        WHERE address = $1
      `;
      const validatorResult = await this.pool.query(validatorQuery, [address]);

      if (validatorResult.rows.length === 0) {
        continue;
      }

      const validator = validatorResult.rows[0];

      const groupQuery = `
        SELECT id, name, address, is_eligible, commission, last_slashed, domain, vote_signer
        FROM "group"
        WHERE id = $1
      `;
      const groupResult = await this.pool.query(groupQuery, [
        validator.group_id,
      ]);

      if (groupResult.rows.length === 0) {
        continue;
      }

      const group = groupResult.rows[0];

      const votesQuery = `
        SELECT total, active, pending, receivable
        FROM group_votes
        WHERE group_id = $1
      `;
      const votesResult = await this.pool.query(votesQuery, [group.id]);

      const membersQuery = `
        SELECT address, vote_signer, elected, score
        FROM validator
        WHERE group_id = $1
      `;
      const membersResult = await this.pool.query(membersQuery, [group.id]);

      const groupInfo: GroupCheckerResult = {
        name: group.name,
        address: group.address,
        isEligible: group.is_eligible,
        votes: votesResult.rows[0],
        members: membersResult.rows,
        commission: group.commission,
        lastSlashed: group.last_slashed,
        domain: group.domain,
        voteSigner: group.vote_signer,
      };

      const result: member = {
        group: groupInfo,
        address: validator.address,
        voteSigner: validator.vote_signer,
        elected: validator.elected,
        score: validator.score,
      };

      results.push(result);
    }

    return results;
  }

  async getUnsignedValidators(blockNum: number): Promise<string[]> {
    const query = `
      SELECT v.id, v.group_id, v.address, v.vote_signer, v.elected, v.score
      FROM unsigned u
      JOIN validator v ON u.validator_id = v.id
      WHERE u.block_num = $1
    `;
    const result = await this.pool.query(query, [blockNum]);

    return result.rows.map((row) => row.address);
  }

  isGroupDataEqual(existingGroup: any, newGroup: GroupCheckerResult): boolean {
    return (
      existingGroup.name === newGroup.name &&
      existingGroup.is_eligible === newGroup.isEligible &&
      existingGroup.commission === newGroup.commission &&
      existingGroup.last_slashed === newGroup.lastSlashed &&
      existingGroup.domain === newGroup.domain &&
      existingGroup.vote_signer === newGroup.voteSigner
    );
  }

  isVotesDataEqual(existingVotes: any, newVotes: any): boolean {
    return (
      existingVotes.total === newVotes.total &&
      existingVotes.active === newVotes.active &&
      existingVotes.pending === newVotes.pending &&
      existingVotes.receivable === newVotes.receivable
    );
  }

  isValidatorDataEqual(existingValidator: any, newValidator: any): boolean {
    return (
      existingValidator.vote_signer === newValidator.voteSigner &&
      existingValidator.elected === newValidator.elected &&
      existingValidator.score === newValidator.score
    );
  }

  async saveUnsignedValidator(
    blockNum: number,
    address: string
  ): Promise<void> {
    const validatorId = await this.upsertValidator(address);
    await this.pool.query(
      "INSERT INTO unsigned (block_num, validator_id) VALUES ($1, $2)",
      [blockNum, validatorId]
    );
  }
}
