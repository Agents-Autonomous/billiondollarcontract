use anchor_lang::prelude::*;
use mpl_core::instructions::CreateV2CpiBuilder;
use crate::state::{GridConfig, BlockMap, ParcelInfo, GRID_SIZE};
use crate::errors::BillionError;
use crate::instructions::claim_parcel::MPL_CORE_ID;

#[derive(Accounts)]
#[instruction(x: u8, y: u8, width: u8, height: u8)]
pub struct AdminMint<'info> {
    #[account(
        mut,
        constraint = authority.key() == grid_config.authority @ BillionError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// CHECK: Recipient of the NFT (not signer)
    pub recipient: UncheckedAccount<'info>,

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

    /// Parcel info PDA - stores asset address for lookups
    #[account(
        init,
        payer = authority,
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

    pub system_program: Program<'info, System>,
}

/// Validates that the admin mint is valid (no ring check, just bounds and unclaimed)
fn validate_admin_mint(
    x: u8,
    y: u8,
    width: u8,
    height: u8,
    block_map: &BlockMap,
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

    // Check each block in the parcel is unclaimed (NO ring check for admin)
    for dy in 0..height {
        for dx in 0..width {
            let block_x = x + dx;
            let block_y = y + dy;

            // Check if block is unclaimed (value == 0)
            let block_value = block_map.get_block(block_x, block_y);
            require!(block_value == 0, BillionError::BlockAlreadyClaimed);
        }
    }

    Ok(())
}

pub fn handler(
    ctx: Context<AdminMint>,
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

    let grid_config = &ctx.accounts.grid_config;

    // Check seeding is enabled
    require!(grid_config.seeding_enabled, BillionError::SeedingDisabled);

    // Validate the admin mint (bounds and unclaimed only, no ring check)
    {
        let block_map = ctx.accounts.block_map.load()?;
        validate_admin_mint(x, y, width, height, &block_map)?;
    }

    // Calculate number of blocks
    let num_blocks = (width as u32).checked_mul(height as u32).ok_or(BillionError::Overflow)?;

    // Get the parcel_id before mutating
    let parcel_id = ctx.accounts.grid_config.next_parcel_id;

    // Update grid_config (NO token burning, just increment parcel_id and update block count)
    let grid_config = &mut ctx.accounts.grid_config;

    // Update total claimed blocks (no reward distribution since no burn)
    grid_config.total_claimed_blocks = grid_config
        .total_claimed_blocks
        .checked_add(num_blocks)
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

    // Get the grid_config bump for PDA signing (collection authority is the GridConfig PDA)
    let bump = ctx.accounts.grid_config.bump;
    let seeds: &[&[u8]] = &[GridConfig::SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .authority(Some(&ctx.accounts.grid_config.to_account_info()))
        .payer(&ctx.accounts.authority.to_account_info())
        .owner(Some(&ctx.accounts.recipient.to_account_info()))
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
        "Admin minted parcel {} to {} at ({}, {}) with dimensions {}x{}",
        parcel_id,
        ctx.accounts.recipient.key(),
        x,
        y,
        width,
        height
    );

    Ok(())
}
