import { Pool } from "pg";
import { GroupCheckerResult } from "./GroupChecker";

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

  async saveGroup(result: GroupCheckerResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

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

      const deleteValidatorsQuery = "DELETE FROM validator WHERE group_id = $1";
      await client.query(deleteValidatorsQuery, [groupId]);

      const validatorsQuery = `
        INSERT INTO validator (group_id, address, vote_signer, elected, score)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (address) DO UPDATE SET
          vote_signer = EXCLUDED.vote_signer,
          elected = EXCLUDED.elected,
          score = EXCLUDED.score
      `;
      for (const member of result.members) {
        const validatorsValues = [
          groupId,
          member.address,
          member.voteSinger,
          member.elected,
          member.score,
        ];
        await client.query(validatorsQuery, validatorsValues);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
