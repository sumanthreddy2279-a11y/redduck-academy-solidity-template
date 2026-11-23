import {
  encodeAbiParameters,
  keccak256,
  hashMessage,
  type WalletClient,
  type Address,
  type Hex,
} from "viem";

export interface ClaimSignatureParts {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export async function signAirdropClaim(
  signerWallet: WalletClient,
  claimant: Address,
  amount: bigint,
  contractAddress: Address,
  chainId: number,
): Promise<ClaimSignatureParts> {
  const messageHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [contractAddress, BigInt(chainId), claimant, amount],
    ),
  );

  const signature = await signerWallet.signMessage({
    message: { raw: messageHash as Hex },
  });

  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const recovery = parseInt(signature.slice(130, 132), 16);
  const v = recovery < 27 ? recovery + 27 : recovery;

  return { v, r, s };
}
