import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pool, Client } from "pg";
import { DatabaseService } from "./Database";
import { GovCheckerResult } from "./GovChecker";

describe("DatabaseService", () => {
  let pool: Pool;
  let databaseService: DatabaseService;

  beforeEach(() => {
    pool = new Pool();
    databaseService = new DatabaseService(pool);
  });

  describe("initialize", () => {
    it("should create the 'group' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS "group"')
      );
    });

    it("should create the 'group_votes' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS group_votes")
      );
    });

    it("should create the 'validator' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS validator")
      );
    });

    it("should create the 'unsigned' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS unsigned")
      );
    });

    it("should create the 'proposer' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS proposer")
      );
    });

    it("should create the 'votes' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS votes")
      );
    });

    it("should create the 'dequeue' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS dequeue")
      );
    });

    it("should create the 'approval' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS approval")
      );
    });

    it("should create the 'execution' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS execution")
      );
    });

    it("should create the 'proposal' table", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      pool.query = queryMock;

      await databaseService.initialize();

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS proposal")
      );
    });
  });

  describe("upsertValidator", () => {
    it("should insert a new validator and return its id", async () => {
      const queryMock = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
      pool.query = queryMock;

      const id = await databaseService.upsertValidator(
        "0x4e957bBC61AFDab63263fFdbAF201F6f596E3e2D"
      );

      expect(queryMock).toHaveBeenCalledWith(
        "INSERT INTO validator (address) VALUES ($1) ON CONFLICT (address) DO NOTHING RETURNING id",
        ["0x4e957bBC61AFDab63263fFdbAF201F6f596E3e2D"]
      );
      expect(id).toBe(1);
    });

    it("should return the id of an existing validator", async () => {
      const queryMock = vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // First query returns no rows
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // Second query returns the existing id
      pool.query = queryMock;

      const id = await databaseService.upsertValidator(
        "0x4e957bBC61AFDab63263fFdbAF201F6f596E3e2D"
      );

      expect(queryMock).toHaveBeenCalledWith(
        "INSERT INTO validator (address) VALUES ($1) ON CONFLICT (address) DO NOTHING RETURNING id",
        ["0x4e957bBC61AFDab63263fFdbAF201F6f596E3e2D"]
      );
      expect(queryMock).toHaveBeenCalledWith(
        "SELECT id FROM validator WHERE address = $1",
        ["0x4e957bBC61AFDab63263fFdbAF201F6f596E3e2D"]
      );
      expect(id).toBe(2);
    });
  });
});
