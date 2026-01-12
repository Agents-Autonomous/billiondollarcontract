use anchor_lang::prelude::*;
use crate::state::BlockMap;

/// CreateBlockMap uses the `zero` constraint because BlockMap (~20KB) exceeds
/// Solana's 10KB limit for account creation in CPI (inner instructions).
///
/// The client must pre-create the account with:
/// 1. SystemProgram.createAccount (with program as owner, correct size)
/// 2. Then call this instruction to initialize it
#[derive(Accounts)]
pub struct CreateBlockMap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The BlockMap account must be pre-created by the client with:
    /// - owner = program ID
    /// - space = BlockMap::SIZE (20016 bytes)
    /// - data = all zeros
    #[account(zero)]
    pub block_map: AccountLoader<'info, BlockMap>,
}

pub fn handler(ctx: Context<CreateBlockMap>) -> Result<()> {
    // Initialize the account (this marks the discriminator)
    let _block_map = ctx.accounts.block_map.load_init()?;
    // blocks array is already zeroed from account creation
    // bump is not needed since this is not a PDA
    msg!("BlockMap initialized at {}", ctx.accounts.block_map.key());
    Ok(())
}
