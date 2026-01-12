import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { PublicKey } from "@solana/web3.js";

async function main() {
  // Get new price from command line args
  const newPriceArg = process.argv[2];
  if (!newPriceArg) {
    console.log("Usage: npx ts-node scripts/update-price.ts <price_per_block>");
    console.log("Example: npx ts-node scripts/update-price.ts 100000000000");
    console.log("  (100000000000 = 100,000 tokens with 6 decimals)");
    process.exit(1);
  }

  const newPrice = new BN(newPriceArg);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Billion as Program<Billion>;
  const authority = provider.wallet;

  console.log("===========================================");
  console.log("  Update Block Price");
  console.log("===========================================\n");

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("New Price:", newPrice.toString(), `(${Number(newPrice) / 1_000_000} tokens)`);

  // Derive GridConfig PDA
  const [gridConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("grid_config")],
    program.programId
  );

  // Fetch current config
  const configBefore = await program.account.gridConfig.fetch(gridConfigPda);
  console.log("\nCurrent price:", configBefore.pricePerBlock.toString(),
    `(${Number(configBefore.pricePerBlock) / 1_000_000} tokens)`);

  // Update price
  console.log("\nUpdating price...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sig = await (program.methods as any)
    .updateConfig(newPrice, null, null, null, null, null)
    .accounts({
      authority: authority.publicKey,
      gridConfig: gridConfigPda,
    })
    .rpc();

  console.log("TX:", sig);

  // Verify
  const configAfter = await program.account.gridConfig.fetch(gridConfigPda);
  console.log("\nNew price:", configAfter.pricePerBlock.toString(),
    `(${Number(configAfter.pricePerBlock) / 1_000_000} tokens)`);

  console.log("\n✅ Price updated successfully!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
