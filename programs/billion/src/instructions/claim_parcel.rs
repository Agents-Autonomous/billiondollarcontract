use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022,
    token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface},
    associated_token::AssociatedToken,
};
use mpl_core::instructions::CreateV2CpiBuilder;
use crate::state::{GridConfig, BlockMap, ParcelInfo, GRID_SIZE, LAND_BUY_REWARD_POOL_SEED};
use crate::errors::BillionError;
use crate::utils::{get_ring, get_unlocked_ring};

// Metaplex Core program ID
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

#[derive(Accounts)]
#[instruction(x: u8, y: u8, width: u8, height: u8)]
pub struct ClaimParcel<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        mut,
        seeds = [GridConfig::SEED],
        bump = grid_config.bump
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// BlockMap address must match the one stored in grid_config
    #[account(
        mut,
        constraint = block_map.key() == grid_config.block_map @ BillionError::Unauthorized
    )]
    pub block_map: AccountLoader<'info, BlockMap>,

    /// Token mint must match the one in grid_config (Token-2022)
    #[account(
        mut,
        constraint = token_mint.key() == grid_config.token_mint @ BillionError::Unauthorized
    )]
    pub token_mint: InterfaceAccount<'info, InterfaceMint>,

    /// Claimer's token account for burning (Token-2022)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = claimer,
        associated_token::token_program = token_program,
    )]
    pub claimer_token_account: InterfaceAccount<'info, InterfaceTokenAccount>,

    /// Land buy reward pool - receives the landowner share
    #[account(
        mut,
        seeds = [LAND_BUY_REWARD_POOL_SEED, grid_config.key().as_ref()],
        bump,
        constraint = land_buy_reward_pool.key() == grid_config.land_buy_reward_pool @ BillionError::InvalidRewardPool
    )]
    pub land_buy_reward_pool: InterfaceAccount<'info, InterfaceTokenAccount>,

    /// Parcel info PDA - stores asset address for lookups
    #[account(
        init,
        payer = claimer,
        space = 8 + ParcelInfo::INIT_SPACE,
        seeds = [ParcelInfo::SEED, &grid_config.next_parcel_id.to_le_bytes()],
        bump
    )]
    pub parcel_info: Account<'info, ParcelInfo>,

    /// New Core asset - must be a signer (keypair generated client-side)
    #[account(mut)]
    pub asset: Signer<'info>,

    /// Core collection - must match grid_config.collection
    /// CHECK: Validated by constraint and Metaplex Core program
    #[account(
        mut,
        constraint = collection.key() == grid_config.collection @ BillionError::InvalidCollection
    )]
    pub collection: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Validates that the claim is valid
fn validate_claim(
    x: u8,
    y: u8,
    width: u8,
    height: u8,
    block_map: &BlockMap,
    grid_config: &GridConfig,
) -> Result<()> {
    // Check dimensions are valid
    require!(width > 0 && height > 0, BillionError::InvalidDimensions);

    // Check bounds
    require!(
        (x as usize) + (width as usize) <= GRID_SIZE,
        BillionError::OutOfBounds
    );
    require!(
        (y as usize) + (height as usize) <= GRID_SIZE,
        BillionError::OutOfBounds
    );

    // Get the currently unlocked ring
    let unlocked_ring = get_unlocked_ring(grid_config.total_burned, &grid_config.ring_thresholds);

    // Check each block in the parcel
    for dy in 0..height {
        for dx in 0..width {
            let block_x = x + dx;
            let block_y = y + dy;

            // Check if block is in unlocked ring
            let block_ring = get_ring(block_x, block_y);
            require!(block_ring <= unlocked_ring, BillionError::RingLocked);

            // Check if block is unclaimed (value == 0)
            let block_value = block_map.get_block(block_x, block_y);
            require!(block_value == 0, BillionError::BlockAlreadyClaimed);
        }
    }

    Ok(())
}

pub fn handler(
    ctx: Context<ClaimParcel>,
    x: u8,
    y: u8,
    width: u8,
    height: u8,
) -> Result<()> {
    // Validate collection is set
    require!(
        ctx.accounts.grid_config.collection != Pubkey::default(),
        BillionError::CollectionNotSet
    );

    // Validate the claim
    {
        let block_map = ctx.accounts.block_map.load()?;
        validate_claim(x, y, width, height, &block_map, &ctx.accounts.grid_config)?;
    }

    // Calculate total cost
    let num_blocks = (width as u32).checked_mul(height as u32).ok_or(BillionError::Overflow)?;
    let total_cost = (num_blocks as u64)
        .checked_mul(ctx.accounts.grid_config.price_per_block)
        .ok_or(BillionError::Overflow)?;

    // Calculate reward/burn split
    let reward_amount = total_cost
        .checked_mul(ctx.accounts.grid_config.land_owners_reward_share_bps as u64)
        .ok_or(BillionError::Overflow)?
        .checked_div(10_000)
        .ok_or(BillionError::Overflow)?;
    let burn_amount = total_cost.checked_sub(reward_amount).ok_or(BillionError::Overflow)?;

    // Verify claimer has sufficient balance
    require!(
        ctx.accounts.claimer_token_account.amount >= total_cost,
        BillionError::InsufficientBalance
    );

    // Transfer reward portion to pool (if any)
    if reward_amount > 0 {
        let cpi_accounts = token_2022::TransferChecked {
            from: ctx.accounts.claimer_token_account.to_account_info(),
            to: ctx.accounts.land_buy_reward_pool.to_account_info(),
            authority: ctx.accounts.claimer.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
        };
        token_2022::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            reward_amount,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    // Burn the burn portion
    if burn_amount > 0 {
        let cpi_accounts = token_2022::Burn {
            mint: ctx.accounts.token_mint.to_account_info(),
            from: ctx.accounts.claimer_token_account.to_account_info(),
            authority: ctx.accounts.claimer.to_account_info(),
        };
        token_2022::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            burn_amount,
        )?;
    }

    // Get the parcel_id before mutating
    let parcel_id = ctx.accounts.grid_config.next_parcel_id;

    // Update grid_config
    let grid_config = &mut ctx.accounts.grid_config;

    // Distribute rewards to existing landowners BEFORE adding new blocks
    if grid_config.total_claimed_blocks > 0 && reward_amount > 0 {
        // Scale by 1e9 for precision
        let reward_increase = (reward_amount as u128)
            .checked_mul(1_000_000_000)
            .ok_or(BillionError::Overflow)?
            .checked_div(grid_config.total_claimed_blocks as u128)
            .ok_or(BillionError::Overflow)?;

        grid_config.land_buy_rewards_per_block = grid_config
            .land_buy_rewards_per_block
            .checked_add(reward_increase)
            .ok_or(BillionError::Overflow)?;
    }

    // Update total claimed blocks (include new parcel)
    grid_config.total_claimed_blocks = grid_config
        .total_claimed_blocks
        .checked_add(num_blocks)
        .ok_or(BillionError::Overflow)?;

    grid_config.total_burned = grid_config
        .total_burned
        .checked_add(burn_amount)
        .ok_or(BillionError::Overflow)?;
    grid_config.next_parcel_id = grid_config
        .next_parcel_id
        .checked_add(1)
        .ok_or(BillionError::Overflow)?;

    // Store values needed for CPI and ParcelInfo
    let uri_base = grid_config.uri_base.clone();
    let current_rewards_per_block = grid_config.land_buy_rewards_per_block;

    // Assign parcel_id to all blocks
    {
        let mut block_map = ctx.accounts.block_map.load_mut()?;
        for dy in 0..height {
            for dx in 0..width {
                block_map.set_block(x + dx, y + dy, parcel_id);
            }
        }
    }

    // Create Core asset
    let name = format!("Parcel #{}", parcel_id);
    let uri = format!("{}{}", uri_base, parcel_id);

    // Get the grid_config bump for PDA signing
    let bump = ctx.accounts.grid_config.bump;
    let seeds: &[&[u8]] = &[GridConfig::SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .authority(Some(&ctx.accounts.grid_config.to_account_info()))
        .payer(&ctx.accounts.claimer.to_account_info())
        .owner(Some(&ctx.accounts.claimer.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(name.clone())
        .uri(uri.clone())
        .invoke_signed(signer_seeds)?;

    // Initialize ParcelInfo
    let parcel_info = &mut ctx.accounts.parcel_info;
    parcel_info.asset = ctx.accounts.asset.key();
    parcel_info.x = x;
    parcel_info.y = y;
    parcel_info.width = width;
    parcel_info.height = height;
    parcel_info.bump = ctx.bumps.parcel_info;
    parcel_info.last_claimed_land_buy_rewards_per_block = current_rewards_per_block;
    parcel_info._reserved = [0u8; 48];

    msg!(
        "Parcel {} claimed at ({}, {}) with dimensions {}x{}, burned {} tokens, {} to rewards pool",
        parcel_id,
        x,
        y,
        width,
        height,
        burn_amount,
        reward_amount
    );

    Ok(())
}
