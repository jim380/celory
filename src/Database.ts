import { Pool } from "pg";
import { GroupCheckerResult, member } from "./GroupChecker";
import { GovCheckerResult } from "./GovChecker";

export class DatabaseService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.initialize();
  }

  public async initialize() {
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

    // Add the missing tables for proposals
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS proposer (
        id SERIAL PRIMARY KEY,
        address TEXT UNIQUE,
        deposit TEXT,
        timestamp TEXT
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        total TEXT,
        yes TEXT,
        no TEXT,
        abstain TEXT,
        UNIQUE (total, yes, no, abstain)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS dequeue (
        id SERIAL PRIMARY KEY,
        status TEXT,
        index TEXT,
        address TEXT,
        timestamp TEXT,
        UNIQUE (status, index, address, timestamp)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS approval (
        id SERIAL PRIMARY KEY,
        status TEXT,
        address TEXT,
        timestamp TEXT,
        UNIQUE (status, address, timestamp)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS execution (
        id SERIAL PRIMARY KEY,
        "from" TEXT,
        timestamp TEXT,
        block_number TEXT,
        tx_hash TEXT,
        UNIQUE ("from", timestamp, block_number, tx_hash)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS proposal (
        id SERIAL PRIMARY KEY,
        proposal_id TEXT UNIQUE,
        status TEXT,
        timespan TEXT,
        title TEXT,
        description TEXT,
        proposer_id INTEGER REFERENCES proposer(id),
        votes_id INTEGER REFERENCES votes(id),
        dequeue_id INTEGER REFERENCES dequeue(id),
        approval_id INTEGER REFERENCES approval(id),
        execution_id INTEGER REFERENCES execution(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        upvotes INTEGER DEFAULT 0  -- Add this line
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

  async upsertProposal(result: GovCheckerResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert proposer
      const proposerQuery = `
        INSERT INTO proposer (address, deposit, timestamp)
        VALUES ($1, $2, $3)
        ON CONFLICT (address) DO UPDATE SET
          deposit = EXCLUDED.deposit,
          timestamp = EXCLUDED.timestamp
        RETURNING id
      `;
      const proposerValues = [
        result.proposer.address,
        result.proposer.deposit,
        result.proposer.timestamp,
      ];
      let proposerResult = await client.query(proposerQuery, proposerValues);
      if (proposerResult.rows.length === 0) {
        proposerResult = await client.query(
          "SELECT id FROM proposer WHERE address = $1",
          [result.proposer.address]
        );
      }
      const proposerId = proposerResult.rows[0].id;

      // Upsert votes
      const votesQuery = `
        INSERT INTO votes (total, yes, no, abstain)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (total, yes, no, abstain) DO NOTHING
        RETURNING id
      `;
      const votesValues = [
        result.votes.total,
        result.votes.yes,
        result.votes.no,
        result.votes.abstain,
      ];
      let votesResult = await client.query(votesQuery, votesValues);
      if (votesResult.rows.length === 0) {
        votesResult = await client.query(
          "SELECT id FROM votes WHERE total = $1 AND yes = $2 AND no = $3 AND abstain = $4",
          votesValues
        );
      }
      const votesId = votesResult.rows[0].id;

      // Upsert dequeue
      const dequeueQuery = `
        INSERT INTO dequeue (status, index, address, timestamp)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (status, index, address, timestamp) DO NOTHING
        RETURNING id
      `;
      const dequeueValues = [
        result.dequeue.status,
        result.dequeue.index,
        result.dequeue.address,
        result.dequeue.timestamp,
      ];
      let dequeueResult = await client.query(dequeueQuery, dequeueValues);
      if (dequeueResult.rows.length === 0) {
        dequeueResult = await client.query(
          "SELECT id FROM dequeue WHERE status = $1 AND index = $2 AND address = $3 AND timestamp = $4",
          dequeueValues
        );
      }
      const dequeueId = dequeueResult.rows[0].id;

      // Upsert approval
      const approvalQuery = `
        INSERT INTO approval (status, address, timestamp)
        VALUES ($1, $2, $3)
        ON CONFLICT (status, address, timestamp) DO NOTHING
        RETURNING id
      `;
      const approvalValues = [
        result.approved.status,
        result.approved.address,
        result.approved.timestamp,
      ];
      let approvalResult = await client.query(approvalQuery, approvalValues);
      if (approvalResult.rows.length === 0) {
        approvalResult = await client.query(
          "SELECT id FROM approval WHERE status = $1 AND address = $2 AND timestamp = $3",
          approvalValues
        );
      }
      const approvalId = approvalResult.rows[0].id;

      // Upsert execution
      const executionQuery = `
        INSERT INTO execution ("from", timestamp, block_number, tx_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("from", timestamp, block_number, tx_hash) DO NOTHING
        RETURNING id
      `;
      const executionValues = [
        result.executed.from,
        result.executed.timestamp,
        result.executed.blockNumber,
        result.executed.txHash,
      ];
      let executionResult = await client.query(executionQuery, executionValues);
      if (executionResult.rows.length === 0) {
        executionResult = await client.query(
          'SELECT id FROM execution WHERE "from" = $1 AND timestamp = $2 AND block_number = $3 AND tx_hash = $4',
          executionValues
        );
      }
      const executionId = executionResult.rows[0].id;

      // Upsert proposal
      const proposalQuery = `
        INSERT INTO proposal (
          proposal_id, status, timespan, title, description, proposer_id, votes_id, dequeue_id, approval_id, execution_id, upvotes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (proposal_id) DO UPDATE SET
          status = EXCLUDED.status,
          timespan = EXCLUDED.timespan,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          proposer_id = EXCLUDED.proposer_id,
          votes_id = EXCLUDED.votes_id,
          dequeue_id = EXCLUDED.dequeue_id,
          approval_id = EXCLUDED.approval_id,
          execution_id = EXCLUDED.execution_id,
          upvotes = EXCLUDED.upvotes,
          created_at = NOW()
        RETURNING id
      `;
      const proposalValues = [
        result.id,
        result.status,
        result.timespan,
        result.title,
        result.description,
        proposerId,
        votesId,
        dequeueId,
        approvalId,
        executionId,
        result.upvotes, // Add this line
      ];
      await client.query(proposalQuery, proposalValues);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getProposalInfo(proposalIds: string[]): Promise<GovCheckerResult[]> {
    const results: GovCheckerResult[] = [];

    for (const proposalId of proposalIds) {
      try {
        const proposalQuery = `
          SELECT id, proposal_id, status, timespan, title, description, proposer_id, votes_id, dequeue_id, approval_id, execution_id, upvotes
          FROM proposal
          WHERE proposal_id = $1
        `;
        const proposalResult = await this.pool.query(proposalQuery, [
          proposalId,
        ]);

        if (proposalResult.rows.length === 0) {
          continue;
        }

        const proposal = proposalResult.rows[0];

        const proposerQuery = `
          SELECT address, deposit, timestamp
          FROM proposer
          WHERE id = $1
        `;
        const proposerResult = await this.pool.query(proposerQuery, [
          proposal.proposer_id,
        ]);

        const votesQuery = `
          SELECT total, yes, no, abstain
          FROM votes
          WHERE id = $1
        `;
        const votesResult = await this.pool.query(votesQuery, [
          proposal.votes_id,
        ]);

        const dequeueQuery = `
          SELECT status, index, address, timestamp
          FROM dequeue
          WHERE id = $1
        `;
        const dequeueResult = await this.pool.query(dequeueQuery, [
          proposal.dequeue_id,
        ]);

        const approvalQuery = `
          SELECT status, address, timestamp
          FROM approval
          WHERE id = $1
        `;
        const approvalResult = await this.pool.query(approvalQuery, [
          proposal.approval_id,
        ]);

        const executionQuery = `
          SELECT "from", timestamp, block_number, tx_hash
          FROM execution
          WHERE id = $1
        `;
        const executionResult = await this.pool.query(executionQuery, [
          proposal.execution_id,
        ]);

        const result: GovCheckerResult = {
          id: proposal.proposal_id,
          status: proposal.status,
          timespan: proposal.timespan,
          title: proposal.title,
          description: proposal.description,
          proposer: {
            address: proposerResult.rows[0].address,
            deposit: proposerResult.rows[0].deposit,
            timestamp: proposerResult.rows[0].timestamp,
          },
          votes: {
            total: votesResult.rows[0].total,
            yes: votesResult.rows[0].yes,
            no: votesResult.rows[0].no,
            abstain: votesResult.rows[0].abstain,
          },
          dequeue: {
            status: dequeueResult.rows[0].status,
            index: dequeueResult.rows[0].index,
            address: dequeueResult.rows[0].address,
            timestamp: dequeueResult.rows[0].timestamp,
          },
          approved: {
            status: approvalResult.rows[0].status,
            address: approvalResult.rows[0].address,
            timestamp: approvalResult.rows[0].timestamp,
          },
          executed: {
            from: executionResult.rows[0].from,
            timestamp: executionResult.rows[0].timestamp,
            blockNumber: executionResult.rows[0].block_number,
            txHash: executionResult.rows[0].tx_hash,
          },
          upvotes: proposal.upvotes,
        };

        results.push(result);
      } catch (error) {
        console.error(`Error processing proposalId ${proposalId}:`, error);
      }
    }

    return results;
  }
}
