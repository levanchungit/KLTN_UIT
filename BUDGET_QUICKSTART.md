# Budget Feature - Quick Reference

## Files Created/Modified

### Database

- ✅ `db/migrate.ts` - Added `budgets` and `budget_allocations` tables

### Repositories

- ✅ `repos/budgetRepo.ts` - Budget CRUD operations (168 lines)
- ✅ `repos/budgetSuggestion.ts` - ML analysis engine (187 lines)

### Screens

- ✅ `app/(tabs)/budget.tsx` - Budget list with progress tracking (324 lines)
- ✅ `app/budget/setup.tsx` - Setup form with validation (160 lines)
- ✅ `app/budget/suggest.tsx` - ML suggestions with confirmation (264 lines)

### Documentation

- ✅ `BUDGET_FEATURE.md` - Comprehensive feature documentation

## Quick Start

### User Flow

1. Navigate to Budget tab → See empty state
2. Tap "Tạo ngân sách" → Setup form
3. Enter income, select period, add lifestyle description (optional)
4. Tap "Tạo ngân sách của tôi" → ML analysis runs
5. Review suggestions (Needs 50%, Wants 30%, Savings 20%)
6. Tap "Xác nhận" → Budget saved, return to list
7. View category progress with red borders for overspending

### Key API Methods

```typescript
// Create budget
import { createBudget } from "@/repos/budgetRepo";
await createBudget({
  name: "Ngân sách tháng",
  totalIncome: 10000000,
  period: "monthly",
  lifestyleDesc: "...",
  startDate: new Date(),
  allocations: [{ categoryId, groupType, allocatedAmount }],
});

// Get active budget with progress
import { computeBudgetProgress } from "@/repos/budgetRepo";
const progress = await computeBudgetProgress(budgetId);
// Returns: { budget, allocations[], totalAllocated, totalSpent }

// Generate ML suggestions
import { generateBudgetSuggestion } from "@/repos/budgetSuggestion";
const suggestions = await generateBudgetSuggestion({
  totalIncome: 10000000,
  period: "monthly",
  lifestyleDesc: "...",
});
// Returns: { needs[], wants[], savings[], totalAllocated }
```

### Visual States

**Empty State**

- Piggy bank icon
- "Chưa có ngân sách" title
- "Tạo kế hoạch chi tiêu thông minh với quy tắc 50/30/20" description
- Green "Tạo ngân sách" button

**Budget List**

- Overall summary card (total budget, total spent, progress bar)
- Grouped sections: Nhu cầu (50%), Mong muốn (30%), Tiết kiệm (20%)
- Category cards with icon, name, spent/allocated amounts
- Progress bar per category
- **Red border** + warning text when exceeded

**Setup Form**

- Income input (numeric, formatted with commas)
- Period toggle (daily/weekly/monthly)
- Lifestyle description textarea (max 500 chars)
- Validation: income > 0

**Suggestions**

- Loading spinner during analysis
- Info card with 50/30/20 explanation
- Three sections with totals
- Category rows with suggested amounts
- Green confirm button

## Technical Details

### ML Classification Logic

Categories are classified into needs/wants/savings based on:

1. **Keyword matching** (e.g., "nhà", "điện" → needs; "mua sắm", "cafe" → wants)
2. **Spending proportion** (>10% of total → needs)
3. **Historical patterns** (budget distributed proportionally within each group)

### Database Schema

```sql
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  total_income INTEGER NOT NULL,
  period TEXT CHECK (period IN ('daily','weekly','monthly')),
  lifestyle_desc TEXT,
  start_date INTEGER NOT NULL,
  end_date INTEGER,
  ...
);

CREATE TABLE budget_allocations (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  group_type TEXT CHECK (group_type IN ('needs','wants','savings')),
  allocated_amount INTEGER NOT NULL,
  ...
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
);
```

### Progress Calculation

- Fetches budget allocations
- Queries transactions within budget period (start_date to end_date or now)
- Groups spending by category
- Calculates percent = (spent / allocated) × 100
- Flags `exceeded = spent > allocated`

### Color Scheme

- Primary green: `#16A34A`
- Danger red: `#E84A3C`
- Theme-aware: uses `colors` from ThemeProvider

## Testing Commands

```bash
# Typecheck budget files
npx tsc --noEmit repos/budgetRepo.ts
npx tsc --noEmit repos/budgetSuggestion.ts
npx tsc --noEmit app/\(tabs\)/budget.tsx
npx tsc --noEmit app/budget/setup.tsx
npx tsc --noEmit app/budget/suggest.tsx

# Run app
npm start
```

## Future Work (per user requirements)

- [ ] Suggestion recommendations when exceeding limits
- [ ] Edit existing budgets
- [ ] Multiple budget support
- [ ] Budget performance history
- [ ] Export budget reports
