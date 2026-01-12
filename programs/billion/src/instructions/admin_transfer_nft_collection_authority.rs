use anchor_lang::prelude::*;
use mpl_core::instructions::UpdateCollectionV1CpiBuilder;
use crate::state::GridConfig;
use crate::errors::BillionError;
use crate::instructions::claim_parcel::MPL_CORE_ID;

#[derive(Accounts)]
pub struct AdminTransferNftCollectionAuthority<'info> {
    /// Only the grid authority can transfer collection authority
    #[account(
        constraint = authority.key() == grid_config.authority @ BillionError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GridConfig::SEED],
        bump = grid_config.bump
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// Core collection - must match grid_config.collection
    /// CHECK: Validated by constraint and Metaplex Core program
    #[account(
        mut,
        constraint = collection.key() == grid_config.collection @ BillionError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// The new update authority for the collection
    /// CHECK: Can be any valid pubkey
    pub new_collection_authority: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AdminTransferNftCollectionAuthority>) -> Result<()> {
    // Validate collection is set
    require!(
        ctx.accounts.grid_config.collection != Pubkey::default(),
        BillionError::CollectionNotSet
    );

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let collection = ctx.accounts.collection.to_account_info();
    let grid_config = ctx.accounts.grid_config.to_account_info();
    let authority = ctx.accounts.authority.to_account_info();
    let new_authority = ctx.accounts.new_collection_authority.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    // Get the grid_config bump for PDA signing (collection authority is the GridConfig PDA)
    let bump = ctx.accounts.grid_config.bump;
    let seeds: &[&[u8]] = &[GridConfig::SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Update the collection's update authority to the new authority
    UpdateCollectionV1CpiBuilder::new(&mpl_core_program)
        .collection(&collection)
        .authority(Some(&grid_config))
        .payer(&authority)
        .new_update_authority(Some(&new_authority))
        .system_program(&system_program)
        .invoke_signed(signer_seeds)?;

    msg!(
        "Transferred NFT collection authority to {}",
        ctx.accounts.new_collection_authority.key()
    );

    Ok(())
}
