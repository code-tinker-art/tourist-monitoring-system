const crypto = require('crypto');
const fs = require('fs');

class TouristBlockchain {
  constructor() {
    this.chain = [];
    this.createGenesisBlock();
  }

  createGenesisBlock() {
    const genesisBlock = {
      index: 0,
      timestamp: Date.now(),
      data: { type: 'GENESIS' },
      previousHash: '0',
      hash: this.calculateHash(0, Date.now(), { type: 'GENESIS' }, '0')
    };
    this.chain.push(genesisBlock);
  }

  calculateHash(index, timestamp, data, previousHash) {
    return crypto
      .createHash('sha256')
      .update(index + timestamp + JSON.stringify(data) + previousHash)
      .digest('hex');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(touristData) {
    const previousBlock = this.getLatestBlock();
    const newBlock = {
      index: previousBlock.index + 1,
      timestamp: Date.now(),
      data: touristData,
      previousHash: previousBlock.hash,
      hash: ''
    };
    newBlock.hash = this.calculateHash(
      newBlock.index,
      newBlock.timestamp,
      newBlock.data,
      newBlock.previousHash
    );
    this.chain.push(newBlock);
    return newBlock;
  }

  getTouristById(touristId) {
    return this.chain.find(block => block.data.touristId === touristId);
  }

  validateChain() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      const recalculatedHash = this.calculateHash(
        currentBlock.index,
        currentBlock.timestamp,
        currentBlock.data,
        currentBlock.previousHash
      );

      if (currentBlock.hash !== recalculatedHash) {
        return false;
      }
    }
    return true;
  }
}

module.exports = TouristBlockchain;
