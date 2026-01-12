use anchor_lang::prelude::*;

pub const GRID_SIZE: usize = 100;
pub const TOTAL_BLOCKS: usize = GRID_SIZE * GRID_SIZE;

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct BlockMap {
    pub blocks: [u16; TOTAL_BLOCKS],
    pub bump: u8,
    pub _padding: [u8; 7], // Align to 8 bytes
}

impl BlockMap {
    pub const SEED: &'static [u8] = b"block_map";

    pub const SIZE: usize = 8 + (2 * TOTAL_BLOCKS) + 1 + 7; // 20016 bytes

    pub fn get_block(&self, x: u8, y: u8) -> u16 {
        let index = (y as usize) * GRID_SIZE + (x as usize);
        self.blocks[index]
    }

    pub fn set_block(&mut self, x: u8, y: u8, parcel_id: u16) {
        let index = (y as usize) * GRID_SIZE + (x as usize);
        self.blocks[index] = parcel_id;
    }
}
