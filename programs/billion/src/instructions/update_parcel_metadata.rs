use anchor_lang::prelude::*;
use mpl_core::instructions::UpdateV1CpiBuilder;
use crate::state::GridConfig;
use crate::errors::BillionError;
use crate::instructions::claim_parcel::MPL_CORE_ID;

#[derive(Accounts)]
pub struct UpdateParcelMetadata<'info> {
    /// Only the grid authority can update parcel metadata
    #[account(
        constraint = authority.key() == grid_config.authority @ BillionError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GridConfig::SEED],
        bump = grid_config.bump
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// The Core asset to update
    /// CHECK: Validated by Metaplex Core program
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,

    /// Core collection - must match grid_config.collection
    /// CHECK: Validated by constraint and Metaplex Core program
    #[account(
        constraint = collection.key() == grid_config.collection @ BillionError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateParcelMetadata>,
    new_name: Option<String>,
    new_uri: Option<String>,
) -> Result<()> {
    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let asset = ctx.accounts.asset.to_account_info();
    let authority = ctx.accounts.authority.to_account_info();
    let grid_config = ctx.accounts.grid_config.to_account_info();
    let collection = ctx.accounts.collection.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    // Get the grid_config bump for PDA signing (collection authority is the GridConfig PDA)
    let bump = ctx.accounts.grid_config.bump;
    let seeds: &[&[u8]] = &[GridConfig::SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let mut builder = UpdateV1CpiBuilder::new(&mpl_core_program);

    builder
        .asset(&asset)
        .collection(Some(&collection))
        .authority(Some(&grid_config))
        .payer(&authority)
        .system_program(&system_program);

    if let Some(name) = new_name.clone() {
        builder.new_name(name);
    }

    if let Some(uri) = new_uri.clone() {
        builder.new_uri(uri);
    }

    builder.invoke_signed(signer_seeds)?;

    msg!("Updated parcel metadata");

    Ok(())
}
