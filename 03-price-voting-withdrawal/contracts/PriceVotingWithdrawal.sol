
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
 * Design:
 * 1. Vote during the voting period.
 * 2. Withdraw tokens at any time using withdraw(price, amount).
 * 3. After voting ends, anyone calls finalize().
 * 4. Read the fixed result using winner().
 *
 * Withdrawals made before finalization reduce the corresponding price's
 * voting weight. Withdrawals after finalization are still allowed, but
 * cannot change the already finalized result.
 *
 * Reflection:
 * We recalculate the winner during finalization using the current net
 * weights of all prices. Every withdrawal reduces the relevant price's
 * weight. The simpler previous approach of only adding votes and tracking
 * the leader would be incorrect because it would leave withdrawn votes
 * counted and could produce the wrong winner.
 *
 * Ties are resolved in favor of the price that was voted for first.
 * If there are no votes, the winning price and weight are both zero.
 */

contract PriceVotingWithdrawal {
    IERC20 public immutable token;
    uint256 public immutable votingEnd;

    mapping(uint256 => uint256) private _weights;
    mapping(address => mapping(uint256 => uint256)) private _locked;

    uint256[] private _prices;
    mapping(uint256 => bool) private _priceExists;

    uint256 private _winningPrice;
    uint256 private _winningWeight;
    bool public finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error InsufficientLocked();
    error TransferFailed();

    event Voted(
        address indexed voter,
        uint256 indexed price,
        uint256 amount
    );

    event Withdrawn(
        address indexed voter,
        uint256 indexed price,
        uint256 amount
    );

    event Finalized(uint256 winningPrice, uint256 winningWeight);

    constructor(IERC20 token_, uint256 votingEnd_) {
        token = token_;
        votingEnd = votingEnd_;
    }

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (finalized) revert AlreadyFinalized();
        if (amount == 0) revert ZeroAmount();

        bool success = token.transferFrom(
            msg.sender,
            address(this),
            amount
        );
        if (!success) revert TransferFailed();

        if (!_priceExists[price]) {
            _priceExists[price] = true;
            _prices.push(price);
        }

        _weights[price] += amount;
        _locked[msg.sender][price] += amount;

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 lockedAmount = _locked[msg.sender][price];

        if (amount > lockedAmount) revert InsufficientLocked();

        // Update accounting before transferring tokens.
        _locked[msg.sender][price] = lockedAmount - amount;
        _weights[price] -= amount;

        bool success = token.transfer(msg.sender, amount);
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, price, amount);
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        uint256 highestWeight = 0;
        uint256 selectedPrice = 0;

        // Strictly greater means the first price wins in a tie.
        for (uint256 i = 0; i < _prices.length; i++) {
            uint256 price = _prices[i];
            uint256 weight = _weights[price];

            if (weight > highestWeight) {
                highestWeight = weight;
                selectedPrice = price;
            }
        }

        _winningPrice = selectedPrice;
        _winningWeight = highestWeight;
        finalized = true;

        emit Finalized(selectedPrice, highestWeight);
    }

    function winner()
        external
        view
        returns (uint256 price, uint256 weight)
    {
        if (!finalized) revert VotingActive();

        return (_winningPrice, _winningWeight);
    }

    function weightOf(uint256 price) external view returns (uint256) {
        return _weights[price];
    }

    function lockedOf(
        address voter,
        uint256 price
    ) external view returns (uint256) {
        return _locked[voter][price];
    }
}
