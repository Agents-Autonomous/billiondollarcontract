import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { Connection, PublicKey } from "@solana/web3.js";

const GRID_SIZE = 100;
const TOTAL_BLOCKS = GRID_SIZE * GRID_SIZE;

// Base62 charset: 1-9 (indices 1-9), A-Z (indices 10-35), a-z (indices 36-61)
// 0 is reserved for empty cells
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function parcelIdToChar(parcelId: number): string {
  if (parcelId === 0) return "0";
  // Map parcel_id to base62 char (1-61 maps to 1-9,A-Z,a-z)
  // For parcel IDs > 61, we'll cycle through or use a special char
  const idx = parcelId % 62;
  if (idx === 0) return "z"; // 62 maps to 'z', 124 maps to 'z', etc.
  return BASE62_CHARS[idx];
}

function deriveGridConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("grid_config")],
    programId
  );
}

async function main() {
  console.log("===========================================");
  console.log("  Billion Grid - Block Map Viewer");
  console.log("===========================================\n");

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Create a minimal provider (no wallet needed for reading)
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    } as anchor.Wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.billion as Program<Billion>;
  console.log("Program ID:", program.programId.toBase58());

  // Derive GridConfig PDA
  const [gridConfigPda] = deriveGridConfig(program.programId);
  console.log("GridConfig PDA:", gridConfigPda.toBase58());

  // Fetch GridConfig to get BlockMap address
  let gridConfig;
  try {
    gridConfig = await program.account.gridConfig.fetch(gridConfigPda);
    console.log("Block Map Address:", gridConfig.blockMap.toBase58());
    console.log("Next Parcel ID:", gridConfig.nextParcelId);
    console.log("Total Claimed Blocks:", gridConfig.totalClaimedBlocks);
    console.log("");
  } catch (err) {
    console.error("Failed to fetch GridConfig:", err);
    process.exit(1);
  }

  // Fetch BlockMap account data directly
  const blockMapAccountInfo = await connection.getAccountInfo(gridConfig.blockMap);
  if (!blockMapAccountInfo) {
    console.error("BlockMap account not found");
    process.exit(1);
  }

  console.log("BlockMap account size:", blockMapAccountInfo.data.length, "bytes");

  // Parse BlockMap data
  // Layout: 8 bytes discriminator + 10000 u16s (20000 bytes) + 1 byte bump + 7 bytes padding
  const data = blockMapAccountInfo.data;
  const DISCRIMINATOR_SIZE = 8;

  // Read the u16 array (little-endian)
  const blocks: number[] = [];
  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    const offset = DISCRIMINATOR_SIZE + i * 2;
    const value = data.readUInt16LE(offset);
    blocks.push(value);
  }

  // Count statistics
  let claimedCount = 0;
  const parcelCounts = new Map<number, number>();

  for (const block of blocks) {
    if (block !== 0) {
      claimedCount++;
      parcelCounts.set(block, (parcelCounts.get(block) || 0) + 1);
    }
  }

  console.log("Claimed blocks:", claimedCount);
  console.log("Empty blocks:", TOTAL_BLOCKS - claimedCount);
  console.log("Unique parcels:", parcelCounts.size);
  console.log("");

  // Print the grid
  console.log("Block Map (100x100 grid):");
  console.log("Legend: 0 = empty, 1-9/A-Z/a-z = parcel ID (mod 62)");
  console.log("");

  // Print column headers (0-9 repeated)
  process.stdout.write("     ");
  for (let x = 0; x < GRID_SIZE; x++) {
    process.stdout.write((x % 10).toString());
  }
  console.log("");

  // Print top border
  process.stdout.write("    +");
  for (let x = 0; x < GRID_SIZE; x++) {
    process.stdout.write("-");
  }
  console.log("+");

  // Print each row
  for (let y = 0; y < GRID_SIZE; y++) {
    // Row label (padded to 3 chars)
    process.stdout.write(y.toString().padStart(3, " ") + " |");

    for (let x = 0; x < GRID_SIZE; x++) {
      const index = y * GRID_SIZE + x;
      const parcelId = blocks[index];
      const char = parcelIdToChar(parcelId);
      process.stdout.write(char);
    }

    console.log("|");
  }

  // Print bottom border
  process.stdout.write("    +");
  for (let x = 0; x < GRID_SIZE; x++) {
    process.stdout.write("-");
  }
  console.log("+");

  // Print parcel summary
  if (parcelCounts.size > 0) {
    console.log("\nParcel Summary:");
    console.log("---------------");
    const sortedParcels = Array.from(parcelCounts.entries()).sort((a, b) => a[0] - b[0]);
    for (const [parcelId, blockCount] of sortedParcels) {
      console.log(`  Parcel ${parcelId.toString().padStart(3, " ")} (${parcelIdToChar(parcelId)}): ${blockCount} blocks`);
    }
  }
}

main().catch(console.error);
