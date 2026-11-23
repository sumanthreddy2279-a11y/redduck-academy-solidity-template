import { keccak256, encodePacked, type Address, type Hex } from "viem";

export interface AirdropEntry {
  account: Address;
  amount: bigint;
}

// Hash an account and its allocation into a Merkle leaf.
export function hashLeaf(entry: AirdropEntry): Hex {
  return keccak256(encodePacked(["address", "uint256"], [entry.account, entry.amount]));
}

// Hash two nodes in sorted order.
function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];

  return keccak256(encodePacked(["bytes32", "bytes32"], [left, right]));
}

export class MerkleTree {
  layers: Hex[][];

  constructor(entries: AirdropEntry[]) {
    if (entries.length === 0) {
      throw new Error("Merkle tree requires at least one entry");
    }

    const leaves = entries.map(hashLeaf);

    this.layers = [leaves];

    while (this.layers[this.layers.length - 1].length > 1) {
      const currentLayer = this.layers[this.layers.length - 1];
      const nextLayer: Hex[] = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1];

        // Promote an unpaired node unchanged to the next layer.
        if (right === undefined) {
          nextLayer.push(left);
        } else {
          nextLayer.push(hashPair(left, right));
        }
      }

      this.layers.push(nextLayer);
    }
  }

  get root(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  // Return sibling hashes from the leaf to the root.
  getProof(index: number): Hex[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.layers[0].length) {
      throw new Error("Invalid leaf index");
    }

    const proof: Hex[] = [];
    let currentIndex = index;

    for (let layerIndex = 0; layerIndex < this.layers.length - 1; layerIndex++) {
      const layer = this.layers[layerIndex];
      const siblingIndex = currentIndex ^ 1;

      if (siblingIndex < layer.length) {
        proof.push(layer[siblingIndex]);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }
}
