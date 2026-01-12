use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, close_account, Mint, TokenAccount, TokenInterface,
    TransferChecked, CloseAccount,
};

use crate::errors::BillionError;
use crate::state::{GridConfig, LAND_BUY_REWARD_POOL_SEED};

#[derive(Accounts)]
pub struct AdminPurge<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GridConfig::SEED],
        bump = grid_config.bump,
        has_one = authority @ BillionError::Unauthorized,
        close = authority,
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// BlockMap account to close - must match grid_config.block_map
    /// CHECK: We verify this matches grid_config.block_map and manually close it
    #[account(
        mut,
        constraint = block_map.key() == grid_config.block_map @ BillionError::Unauthorized,
    )]
    pub block_map: AccountInfo<'info>,

    /// Token mint for the reward pool
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Land buy reward pool to drain and close
    #[account(
        mut,
        seeds = [LAND_BUY_REWARD_POOL_SEED, grid_config.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = grid_config,
    )]
    pub land_buy_reward_pool: InterfaceAccount<'info, TokenAccount>,

    /// Authority's token account to receive drained tokens
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = authority,
    )]
    pub authority_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AdminPurge>) -> Result<()> {
    let grid_config = &ctx.accounts.grid_config;
    let reward_pool = &ctx.accounts.land_buy_reward_pool;

    // Get the amount of tokens in the reward pool
    let amount = reward_pool.amount;
    let decimals = ctx.accounts.token_mint.decimals;

    // Signer seeds for grid_config PDA
    let signer_seeds: &[&[&[u8]]] = &[&[
        GridConfig::SEED,
        &[grid_config.bump],
    ]];

    // Step 1: Transfer all tokens from reward pool to authority
    if amount > 0 {
        msg!("Draining {} tokens from reward pool", amount);

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.land_buy_reward_pool.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: ctx.accounts.grid_config.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;
    }

    // Step 2: Close the reward pool token account
    msg!("Closing reward pool token account");
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.land_buy_reward_pool.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.grid_config.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Step 3: Close the BlockMap account (manually since it's zero_copy)
    let block_map = &ctx.accounts.block_map;
    let block_map_lamports = block_map.lamports();

    msg!("Closing BlockMap account, recovering {} lamports", block_map_lamports);

    // Transfer lamports from block_map to authority
    **block_map.try_borrow_mut_lamports()? = 0;
    **ctx.accounts.authority.try_borrow_mut_lamports()? = ctx
        .accounts
        .authority
        .lamports()
        .checked_add(block_map_lamports)
        .ok_or(BillionError::Overflow)?;

    // Zero out the data
    let mut data = block_map.try_borrow_mut_data()?;
    data.fill(0);

    // Note: GridConfig is closed automatically by the `close = authority` constraint

    msg!("Admin purge complete. All accounts closed.");
    Ok(())
}
