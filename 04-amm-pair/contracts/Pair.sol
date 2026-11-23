// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Pair is ERC20 {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    // Permanently locked LP tokens.
    address private constant LOCKED_LIQUIDITY = address(0xdead);

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    error InsufficientLiquidity();
    error InsufficientAmount();
    error InsufficientOutput();
    error InvalidToken();

    event LiquidityAdded(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swapped(address indexed who, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(IERC20 _token0, IERC20 _token1) ERC20("Simple AMM LP", "sLP") {
        token0 = _token0;
        token1 = _token1;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (amountIn == 0) revert InsufficientAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;

        return numerator / denominator;
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        if (amount0 == 0 || amount1 == 0) revert InsufficientAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            uint256 initialLiquidity = _sqrt(amount0 * amount1);

            if (initialLiquidity <= MINIMUM_LIQUIDITY) {
                revert InsufficientLiquidity();
            }

            liquidity = initialLiquidity - MINIMUM_LIQUIDITY;

            _mint(LOCKED_LIQUIDITY, MINIMUM_LIQUIDITY);
        } else {
            if (reserve0 == 0 || reserve1 == 0) {
                revert InsufficientLiquidity();
            }

            uint256 liquidity0 = (amount0 * total) / reserve0;
            uint256 liquidity1 = (amount1 * total) / reserve1;

            liquidity = _min(liquidity0, liquidity1);
        }

        if (liquidity == 0) revert InsufficientLiquidity();

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        _mint(msg.sender, liquidity);

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }

    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) revert InsufficientAmount();

        uint256 total = totalSupply();

        if (total == 0 || reserve0 == 0 || reserve1 == 0) {
            revert InsufficientLiquidity();
        }

        amount0 = (liquidity * reserve0) / total;
        amount1 = (liquidity * reserve1) / total;

        if (amount0 == 0 || amount1 == 0) {
            revert InsufficientLiquidity();
        }

        _burn(msg.sender, liquidity);

        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        uint256 currentReserveIn;
        uint256 currentReserveOut;
        IERC20 inputToken;
        IERC20 outputToken;

        if (tokenIn == address(token0)) {
            currentReserveIn = reserve0;
            currentReserveOut = reserve1;
            inputToken = token0;
            outputToken = token1;
        } else if (tokenIn == address(token1)) {
            currentReserveIn = reserve1;
            currentReserveOut = reserve0;
            inputToken = token1;
            outputToken = token0;
        } else {
            revert InvalidToken();
        }

        amountOut = getAmountOut(amountIn, currentReserveIn, currentReserveOut);

        if (amountOut < minAmountOut) revert InsufficientOutput();

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        outputToken.safeTransfer(msg.sender, amountOut);

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
