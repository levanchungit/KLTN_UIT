# Budget Feature Documentation

## Overview

The budget feature allows users to create smart spending plans based on the 50/30/20 rule using machine learning analysis of their transaction history.

## Architecture

### Database Schema

Two new tables added via migration (`db/migrate.ts`):

**budgets**

- Stores overall budget plans
- Fields: id, user_id, name, total_income, period (daily/weekly/monthly), lifestyle_desc, start_date, end_date

**budget_allocations**

- Stores per-category spending limits
- Fields: id, budget_id, category_id, group_type (needs/wants/savings), allocated_amount
- Links budgets to categories with spending limits

### Repositories

**`repos/budgetRepo.ts`**

- CRUD operations for budgets
- `createBudget()` - Create new budget with allocations
- `listBudgets()` - Get all user budgets
- `getBudgetById()` - Fetch specific budget
- `listBudgetAllocations()` - Get category allocations for a budget
- `computeBudgetProgress()` - Calculate spending vs. limits with overflow detection
- `getActiveBudget()` - Find currently active budget
- `deleteBudget()` - Remove budget

**`repos/budgetSuggestion.ts`**

- ML-powered suggestion engine
- `generateBudgetSuggestion()` - Analyzes transaction history to suggest budget allocations
- Implements 50/30/20 rule as baseline
- Classifies categories into needs/wants/savings based on:
  - Historical spending patterns
  - Category name keywords
  - Spending proportions
- Falls back to sensible defaults if no transaction history exists

### User Flows

#### Screen 1: Budget List (`app/(tabs)/budget.tsx`)

- **Empty State**: Shows piggy bank icon with "Create Budget" CTA
- **Active Budget View**:
  - Overall summary card with total budget and spending
  - Grouped category cards (Needs 50%, Wants 30%, Savings 20%)
  - Progress bars for each category
  - Red border and warning when category exceeds limit
  - Pull-to-refresh support
- **Navigation**: "+" button to create new budget

#### Screen 2: Setup Form (`app/budget/setup.tsx`)

- **Inputs**:
  - Income amount (formatted with commas)
  - Budget period (daily/weekly/monthly toggle)
  - Lifestyle description (optional, max 500 chars)
- **Validation**: Ensures income is valid number > 0
- **Action**: "Create my budget" button triggers ML analysis and navigates to suggestions

#### Screen 3: Suggestions (`app/budget/suggest.tsx`)

- **Loading State**: Shows spinner while analyzing transaction history
- **Suggestion Display**:
  - Info card explaining 50/30/20 rule
  - Three sections (Needs, Wants, Savings) with totals
  - Category rows showing suggested allocation amounts
- **Confirmation**: "Confirm" button saves budget to DB and returns to list

## ML Analysis Logic

The suggestion engine (`budgetSuggestion.ts`) works as follows:

1. **Baseline Calculation**

   - 50% income → Needs
   - 30% income → Wants
   - 20% income → Savings

2. **Historical Analysis**

   - Fetches last 3 months of expense transactions
   - Groups spending by category
   - Calculates spending proportions

3. **Category Classification**

   - **Needs keywords**: nhà, điện, nước, thức ăn, đồ uống, sức khỏe, giáo dục, di chuyển, wifi, 4g
   - **Wants keywords**: mua sắm, giải trí, cafe, quà, đám tiệc, mỹ phẩm, hớt tóc
   - **Savings keywords**: tiết kiệm, đầu tư
   - High-proportion categories (>10% of total spending) auto-classified as needs

4. **Budget Distribution**

   - Within each group, distributes budget proportionally to historical spending
   - Balances to exact group totals (handles rounding)

5. **Fallback Defaults**
   - If no history: creates default categories (Food 40%, Housing 60% for needs; Shopping for wants; Savings for savings)

## Visual Design

### Color Coding

- **Normal Progress**: Green (#16A34A)
- **Exceeded Limit**: Red (#E84A3C) border + warning text
- **Progress Bars**: 6-8px height, rounded corners
- **Cards**: 12px radius, theme-aware backgrounds

### Typography

- **Section Titles**: 16px, bold
- **Category Names**: 14-15px
- **Amounts**: 13-16px, formatted with VND locale
- **Helper Text**: 12-13px, muted color

### Icons

- MaterialCommunityIcons throughout
- Category icons from DB (mc:/mi: prefix support)
- Piggy bank for empty state

## Key Features

✅ **Smart Analysis**: ML-based suggestions using transaction history  
✅ **50/30/20 Rule**: Industry-standard budgeting framework  
✅ **Visual Warnings**: Red borders when spending exceeds limits  
✅ **Real-time Progress**: Spending calculated on-the-fly from transactions  
✅ **Pull-to-Refresh**: Keep budget data current  
✅ **Theme Support**: Dark/light mode compatible  
✅ **Flexible Periods**: Daily/weekly/monthly budgets

## Future Enhancements

🔮 **Planned** (mentioned by user as "future feature"):

- Suggestions when exceeding category limits
- Actionable recommendations to get back on track
- Multi-budget support with priority/scheduling
- Budget editing and adjustment
- Historical budget performance tracking
- Export budget reports

## Technical Notes

- All database operations use the queued `db` wrapper for transaction safety
- Type casting with `as any` used for SQLite binding parameters (matches existing repo pattern)
- Budget periods stored as enum but not yet enforced in date calculations (assumes monthly for progress)
- Active budget query uses `start_date` and `end_date` to find current budget
- Category icon mapping handles both `mc:` and `mi:` prefixes for consistency

## Testing Checklist

- [ ] Create budget with no transaction history (defaults)
- [ ] Create budget with 3+ months of transactions (ML suggestions)
- [ ] View budget list with active budget
- [ ] Verify red border appears when category exceeds limit
- [ ] Test pull-to-refresh on budget list
- [ ] Navigate through all three screens
- [ ] Confirm budget saves and persists
- [ ] Test different period types (daily/weekly/monthly)
- [ ] Verify spending calculations are accurate
- [ ] Check theme compatibility (dark/light mode)
