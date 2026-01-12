use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022,
    token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface},
    associated_token::AssociatedToken,
};
use crate::state::{GridConfig, ParcelInfo, LAND_BUY_REWARD_POOL_SEED};
use crate::errors::BillionError;

#[derive(Accounts)]
#[instruction(parcel_id: u16)]
pub struct ClaimLandBuyRewards<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        seeds = [GridConfig::SEED],
        bump = grid_config.bump
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// ParcelInfo PDA - derived from parcel_id
    #[account(
        mut,
        seeds = [ParcelInfo::SEED, &parcel_id.to_le_bytes()],
        bump = parcel_info.bump
    )]
    pub parcel_info: Account<'info, ParcelInfo>,

    /// The Metaplex Core asset - must match parcel_info.asset
    /// CHECK: Validated by constraint, ownership checked in handler
    #[account(
        constraint = asset.key() == parcel_info.asset @ BillionError::AssetMismatch
    )]
    pub asset: UncheckedAccount<'info>,

    /// Land buy reward pool holding the tokens
    #[account(
        mut,
        seeds = [LAND_BUY_REWARD_POOL_SEED, grid_config.key().as_ref()],
        bump,
        constraint = land_buy_reward_pool.key() == grid_config.land_buy_reward_pool @ BillionError::InvalidRewardPool
    )]
    pub land_buy_reward_pool: InterfaceAccount<'info, InterfaceTokenAccount>,

    /// Claimer's token account to receive rewards
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = claimer,
        associated_token::token_program = token_program,
    )]
    pub claimer_token_account: InterfaceAccount<'info, InterfaceTokenAccount>,

    #[account(
        constraint = token_mint.key() == grid_config.token_mint @ BillionError::Unauthorized
    )]
    pub token_mint: InterfaceAccount<'info, InterfaceMint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Parse a Metaplex Core asset account to extract the owner
fn get_core_asset_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    // Deserialize the Core asset using mpl-core
    let asset_data = asset_info.try_borrow_data()?;

    // BaseAssetV1 layout:
    // - key: 1 byte (discriminator)
    // - owner: 32 bytes
    // - update_authority: varies
    // The owner is at offset 1
    if asset_data.len() < 33 {
        return Err(BillionError::InvalidCoreAsset.into());
    }

    // Read owner from bytes 1-33
    let owner_bytes: [u8; 32] = asset_data[1..33]
        .try_into()
        .map_err(|_| BillionError::InvalidCoreAsset)?;

    Ok(Pubkey::new_from_array(owner_bytes))
}

pub fn handler(ctx: Context<ClaimLandBuyRewards>, parcel_id: u16) -> Result<()> {
    // Verify claimer owns the NFT
    let owner = get_core_asset_owner(&ctx.accounts.asset.to_account_info())?;
    require!(owner == ctx.accounts.claimer.key(), BillionError::NotOwner);

    let parcel_info = &mut ctx.accounts.parcel_info;
    let grid_config = &ctx.accounts.grid_config;

    // Calculate owed rewards using the accumulator pattern
    // Both values are u128 now, so subtraction stays in u128
    let rewards_delta = grid_config
        .land_buy_rewards_per_block
        .checked_sub(parcel_info.last_claimed_land_buy_rewards_per_block)
        .ok_or(BillionError::Overflow)?;

    // owed = block_count * rewards_delta / 1e9 (unscale)
    let owed_u128 = (parcel_info.block_count() as u128)
        .checked_mul(rewards_delta)
        .ok_or(BillionError::Overflow)?
        .checked_div(1_000_000_000)
        .ok_or(BillionError::Overflow)?;

    // Convert to u64 for token transfer (final amount should fit in u64)
    let owed = u64::try_from(owed_u128)
        .map_err(|_| BillionError::Overflow)?;

    require!(owed > 0, BillionError::NothingToClaim);

    // Update last claimed checkpoint
    parcel_info.last_claimed_land_buy_rewards_per_block = grid_config.land_buy_rewards_per_block;

    // Transfer from pool to claimer (signed by GridConfig PDA)
    let bump = grid_config.bump;
    let seeds: &[&[u8]] = &[GridConfig::SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let cpi_accounts = token_2022::TransferChecked {
        from: ctx.accounts.land_buy_reward_pool.to_account_info(),
        to: ctx.accounts.claimer_token_account.to_account_info(),
        authority: ctx.accounts.grid_config.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
    };
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        owed,
        ctx.accounts.token_mint.decimals,
    )?;

    msg!(
        "Claimed {} tokens for parcel {} ({} blocks)",
        owed,
        parcel_id,
        parcel_info.block_count()
    );

    Ok(())
}
