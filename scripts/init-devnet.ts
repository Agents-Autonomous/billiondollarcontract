import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ============================================
// CONFIGURATION - Update these values!
// ============================================

// Your existing Token-2022 mint on devnet
const EXISTING_TOKEN_MINT = new PublicKey(
  "8a2vZUPUa8UU3bxvH7L2QRDUiHNRkVttGdBwXrkgVKud"
);

// Set to true to use existing mint, false to create a new one
const USE_EXISTING_MINT = true;

// Metaplex Core Program ID
const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

// Grid constants (must match Rust)
const BLOCK_MAP_SIZE = 8 + 2 * 10000 + 1 + 7; // 20016 bytes

// ============================================
// Cost tracking helper
// ============================================
interface CostEntry {
  step: string;
  cost: number;
  tx?: string;
}

const costs: CostEntry[] = [];

async function trackCost(
  provider: anchor.AnchorProvider,
  stepName: string,
  action: () => Promise<string | void>
): Promise<string | void> {
  const balanceBefore = await provider.connection.getBalance(
    provider.wallet.publicKey
  );

  const result = await action();

  // Wait a bit for balance to update
  await new Promise((resolve) => setTimeout(resolve, 500));

  const balanceAfter = await provider.connection.getBalance(
    provider.wallet.publicKey
  );

  const cost = (balanceBefore - balanceAfter) / 1e9;
  costs.push({
    step: stepName,
    cost,
    tx: typeof result === "string" ? result : undefined,
  });

  console.log(`   Cost: ${cost.toFixed(6)} SOL`);

  return result;
}

// Helper functions for PDA derivation
function deriveGridConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("grid_config")],
    programId
  );
}

async function main() {
  console.log("===========================================");
  console.log("  Billion Grid - Devnet Initialization");
  console.log("===========================================\n");

  // Configure provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.billion as Program<Billion>;
  const authority = provider.wallet as anchor.Wallet;

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Network:", provider.connection.rpcEndpoint);
  console.log("");

  // Check balance
  const startingBalance = await provider.connection.getBalance(
    authority.publicKey
  );
  console.log("Starting Balance:", startingBalance / 1e9, "SOL");

  if (startingBalance < 0.5 * 1e9) {
    console.error(
      "Insufficient balance. Need at least 0.5 SOL for initialization."
    );
    console.log("Run: solana airdrop 2");
    process.exit(1);
  }

  // Derive PDAs
  const [gridConfigPda] = deriveGridConfig(program.programId);
  console.log("\nGridConfig PDA:", gridConfigPda.toBase58());

  // Check if already initialized
  try {
    const existingConfig = await program.account.gridConfig.fetch(
      gridConfigPda
    );
    console.log("\n[!] Grid is already initialized!");
    console.log("    Authority:", existingConfig.authority.toBase58());
    console.log("    Token Mint:", existingConfig.tokenMint.toBase58());
    console.log("    Block Map:", existingConfig.blockMap.toBase58());
    console.log("    Collection:", existingConfig.collection.toBase58());
    console.log(
      "    Price per Block:",
      existingConfig.pricePerBlock.toString()
    );
    console.log("    Total Burned:", existingConfig.totalBurned.toString());
    console.log("    Next Parcel ID:", existingConfig.nextParcelId);
    console.log("    URI Base:", existingConfig.uriBase);
    console.log("    Seeding Enabled:", existingConfig.seedingEnabled);
    process.exit(0);
  } catch {
    console.log("Grid not yet initialized. Proceeding with setup...\n");
  }

  // ============================================
  // Step 1: Get or Create Token Mint
  // ============================================
  let tokenMint: PublicKey;

  if (USE_EXISTING_MINT) {
    console.log("Step 1: Using existing Token-2022 Mint...");
    tokenMint = EXISTING_TOKEN_MINT;
    console.log("   Token Mint:", tokenMint.toBase58());
    console.log("   Cost: 0.000000 SOL (existing mint)");
    costs.push({ step: "Token Mint (existing)", cost: 0 });
  } else {
    console.log("Step 1: Creating Token-2022 Mint...");
    const { TOKEN_2022_PROGRAM_ID, createMint } = await import(
      "@solana/spl-token"
    );

    await trackCost(provider, "Create Token-2022 Mint", async () => {
      tokenMint = await createMint(
        provider.connection,
        authority.payer,
        authority.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      console.log("   Token Mint:", tokenMint!.toBase58());
    });
  }

  // ============================================
  // Step 2: Create BlockMap Account
  // ============================================
  console.log("\nStep 2: Creating BlockMap Account...");

  const blockMapKeypair = Keypair.generate();
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(
    BLOCK_MAP_SIZE
  );

  console.log("   BlockMap Address:", blockMapKeypair.publicKey.toBase58());
  console.log("   Size:", BLOCK_MAP_SIZE, "bytes");
  console.log("   Rent Deposit:", lamports / 1e9, "SOL");

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: blockMapKeypair.publicKey,
    lamports,
    space: BLOCK_MAP_SIZE,
    programId: program.programId,
  });

  const createBlockMapIx = await program.methods
    .createBlockMap()
    .accounts({
      payer: authority.publicKey,
      blockMap: blockMapKeypair.publicKey,
    })
    .instruction();

  const tx1 = new anchor.web3.Transaction()
    .add(createAccountIx)
    .add(createBlockMapIx);

  const sig1 = await trackCost(
    provider,
    "Create BlockMap Account",
    async () => {
      const sig = await provider.sendAndConfirm(tx1, [blockMapKeypair]);
      console.log("   TX:", sig);
      return sig;
    }
  );

  // ============================================
  // Step 3: Initialize Grid Config
  // ============================================
  console.log("\nStep 3: Initializing Grid Config...");

  // Configuration - adjust these values as needed
  const pricePerBlock = new BN(100_000_000_000); // 100_000 tokens (with 6 decimals)
  const ringThresholds = [
    new BN(0), // Ring 1 unlocked at start
    new BN(50_000_000_000_000), // Ring 2 at 50M tokens burned
    new BN(100_000_000_000_000), // Ring 3 at 100M tokens burned
    new BN(150_000_000_000_000), // Ring 4 at 150M tokens burned
    new BN(200_000_000_000_000), // Ring 5 at 200M tokens burned
    new BN(250_000_000_000_000), // Ring 6 at 250M tokens burned
    new BN(300_000_000_000_000), // Ring 7 at 300M tokens burned
    new BN(350_000_000_000_000), // Ring 8 at 350M tokens burned
    new BN(400_000_000_000_000), // Ring 9 at 400M tokens burned
    new BN(450_000_000_000_000), // Ring 10 at 450M tokens burned
  ];
  const uriBase =
    "https://million-dollar-api-staging.seva-e96.workers.dev/parcel"; // Update this!

  const landOwnersRewardShareBps = 2000; // 20%

  // Derive land buy reward pool PDA
  const [landBuyRewardPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("land_buy_reward_pool"), gridConfigPda.toBuffer()],
    program.programId
  );
  console.log("   Land Buy Reward Pool:", landBuyRewardPool.toBase58());

  const sig2 = await trackCost(provider, "Initialize Grid Config", async () => {
    const sig = await program.methods
      .initialize(
        pricePerBlock,
        ringThresholds,
        uriBase,
        landOwnersRewardShareBps
      )
      .accountsPartial({
        authority: authority.publicKey,
        tokenMint,
        gridConfig: gridConfigPda,
        blockMap: blockMapKeypair.publicKey,
        landBuyRewardPool,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   TX:", sig);
    return sig;
  });

  // ============================================
  // Step 4: Create Metaplex Core Collection
  // ============================================
  console.log("\nStep 4: Creating Metaplex Core Collection...");

  const { createCollectionV1 } = await import("@metaplex-foundation/mpl-core");
  const { createUmi } = await import(
    "@metaplex-foundation/umi-bundle-defaults"
  );
  const { generateSigner, keypairIdentity, publicKey } = await import(
    "@metaplex-foundation/umi"
  );
  const { fromWeb3JsKeypair } = await import(
    "@metaplex-foundation/umi-web3js-adapters"
  );

  const umi = createUmi(provider.connection.rpcEndpoint);

  const umiKeypair = fromWeb3JsKeypair(authority.payer);
  umi.use(keypairIdentity(umiKeypair));

  const collectionSigner = generateSigner(umi);
  const collectionPubkey = new PublicKey(collectionSigner.publicKey.toString());

  console.log("   Collection Address:", collectionPubkey.toBase58());

  const gridConfigPdaUmi = publicKey(gridConfigPda.toBase58());

  // Collection metadata URL - points to our staging API
  const collectionUri =
    "https://million-dollar-api-staging.seva-e96.workers.dev/collection";

  await trackCost(provider, "Create Metaplex Core Collection", async () => {
    await createCollectionV1(umi, {
      collection: collectionSigner,
      name: "Billeon Doolars Bern Club",
      uri: collectionUri,
      updateAuthority: gridConfigPdaUmi,
    }).sendAndConfirm(umi);
    console.log("   Collection URI:", collectionUri);
    console.log("   Collection created successfully!");
  });

  // ============================================
  // Step 5: Update Config with Collection
  // ============================================
  console.log("\nStep 5: Updating config with collection...");

  const sig3 = await trackCost(
    provider,
    "Update Config with Collection",
    async () => {
      const sig = await program.methods
        .updateConfig(null, null, null, null, collectionPubkey, null)
        .accountsPartial({
          authority: authority.publicKey,
          gridConfig: gridConfigPda,
        })
        .rpc();
      console.log("   TX:", sig);
      return sig;
    }
  );

  // ============================================
  // Cost Summary
  // ============================================
  const endingBalance = await provider.connection.getBalance(
    authority.publicKey
  );
  const totalSpent = (startingBalance - endingBalance) / 1e9;

  console.log("\n===========================================");
  console.log("  Cost Breakdown");
  console.log("===========================================\n");

  console.log("Step                              Cost (SOL)");
  console.log("--------------------------------------------");
  for (const entry of costs) {
    const stepPadded = entry.step.padEnd(34);
    console.log(`${stepPadded} ${entry.cost.toFixed(6)}`);
  }
  console.log("--------------------------------------------");
  console.log(`${"TOTAL".padEnd(34)} ${totalSpent.toFixed(6)}`);
  console.log("");
  console.log(`Starting Balance:  ${(startingBalance / 1e9).toFixed(6)} SOL`);
  console.log(`Ending Balance:    ${(endingBalance / 1e9).toFixed(6)} SOL`);

  // ============================================
  // Summary
  // ============================================
  console.log("\n===========================================");
  console.log("  Initialization Complete!");
  console.log("===========================================\n");

  const finalConfig = await program.account.gridConfig.fetch(gridConfigPda);

  console.log("Program ID:      ", program.programId.toBase58());
  console.log("Grid Config PDA: ", gridConfigPda.toBase58());
  console.log("Token Mint:      ", tokenMint!.toBase58());
  console.log("Block Map:       ", blockMapKeypair.publicKey.toBase58());
  console.log("Collection:      ", collectionPubkey.toBase58());
  console.log(
    "Price per Block: ",
    finalConfig.pricePerBlock.toString(),
    "(",
    finalConfig.pricePerBlock.toNumber() / 1e6,
    "tokens)"
  );
  console.log("Seeding Enabled: ", finalConfig.seedingEnabled);
  console.log("URI Base:        ", finalConfig.uriBase);
  console.log("");
  console.log("View on Solana Explorer:");
  console.log(
    `https://explorer.solana.com/address/${program.programId.toBase58()}?cluster=devnet`
  );
}

main().catch(console.error);
