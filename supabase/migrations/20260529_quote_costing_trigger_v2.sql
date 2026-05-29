-- Fix quote_costing_lines trigger:
-- MPF/HMF only calculate when EXW cost is provided, zero when no cost entered.

CREATE OR REPLACE FUNCTION calculate_quote_line_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.exw_cost_per_case, 0) > 0 THEN

    -- China 25% tariff (only for China origin, only if not domestic)
    NEW.china_tariff_25_pct := CASE
      WHEN NEW.freight_method = 'DOMESTIC' THEN 0
      WHEN NEW.country_of_origin = 'CHINA' THEN NEW.exw_cost_per_case * 0.25
      ELSE 0
    END;

    -- 10% duty (all foreign origins, not domestic/USA)
    NEW.duty_10_pct := CASE
      WHEN NEW.freight_method = 'DOMESTIC' THEN 0
      WHEN NEW.country_of_origin = 'USA' THEN 0
      ELSE NEW.exw_cost_per_case * 0.10
    END;

    -- MPF auto-calc if user left it at 0
    IF COALESCE(NEW.mpf, 0) = 0
       AND NEW.freight_method != 'DOMESTIC'
       AND NEW.country_of_origin != 'USA' THEN
      NEW.mpf := NEW.exw_cost_per_case * 0.003464;
    END IF;

    -- HMF auto-calc if user left it at 0 (ocean only)
    IF COALESCE(NEW.hmf, 0) = 0 THEN
      NEW.hmf := CASE
        WHEN NEW.freight_method = 'OCEAN'
             AND NEW.country_of_origin != 'USA' THEN NEW.exw_cost_per_case * 0.00125
        ELSE 0
      END;
    END IF;

    -- Zero out duties for domestic/USA
    IF NEW.freight_method = 'DOMESTIC' OR NEW.country_of_origin = 'USA' THEN
      NEW.china_tariff_25_pct := 0;
      NEW.duty_10_pct := 0;
      NEW.mpf := COALESCE(NEW.mpf, 0);
      NEW.hmf := 0;
    END IF;

  ELSE
    -- No EXW cost — zero everything
    NEW.china_tariff_25_pct := 0;
    NEW.duty_10_pct := 0;
    IF COALESCE(NEW.mpf, 0) = 0 THEN NEW.mpf := 0; END IF;
    IF COALESCE(NEW.hmf, 0) = 0 THEN NEW.hmf := 0; END IF;
  END IF;

  -- Total duties
  NEW.total_duties_per_case :=
    COALESCE(NEW.china_tariff_25_pct, 0) +
    COALESCE(NEW.duty_10_pct, 0) +
    COALESCE(NEW.mpf, 0) +
    COALESCE(NEW.hmf, 0);

  -- Total landed cost
  NEW.total_cost_per_case :=
    COALESCE(NEW.exw_cost_per_case, 0) +
    COALESCE(NEW.freight_cost_per_case, 0) +
    COALESCE(NEW.total_duties_per_case, 0) +
    COALESCE(NEW.packaging_cost_per_case, 0) +
    COALESCE(NEW.other_cost_1_amount, 0) +
    COALESCE(NEW.other_cost_2_amount, 0) +
    COALESCE(NEW.other_cost_3_amount, 0) +
    COALESCE(NEW.broker_inv_amount, 0);

  -- Cost per piece
  IF COALESCE(NEW.packing_per_case, 0) > 0 THEN
    NEW.cost_per_piece := NEW.total_cost_per_case / NEW.packing_per_case;
  ELSE
    NEW.cost_per_piece := 0;
  END IF;

  -- Selling price
  NEW.selling_price_per_case :=
    NEW.total_cost_per_case * (1 + COALESCE(NEW.markup_pct, 45) / 100);

  IF COALESCE(NEW.packing_per_case, 0) > 0 THEN
    NEW.selling_price_per_piece := NEW.selling_price_per_case / NEW.packing_per_case;
  ELSE
    NEW.selling_price_per_piece := 0;
  END IF;

  -- Profit
  NEW.profit_per_case := NEW.selling_price_per_case - NEW.total_cost_per_case;

  IF COALESCE(NEW.selling_price_per_case, 0) > 0 THEN
    NEW.profit_margin_pct :=
      (NEW.profit_per_case / NEW.selling_price_per_case) * 100;
  ELSE
    NEW.profit_margin_pct := 0;
  END IF;

  -- Order totals
  IF COALESCE(NEW.order_qty, 0) > 0 THEN
    NEW.total_profit := NEW.profit_per_case * NEW.order_qty;
    NEW.total_income := NEW.selling_price_per_case * NEW.order_qty;
  ELSE
    NEW.total_profit := 0;
    NEW.total_income := 0;
  END IF;

  NEW.ddp_price_per_case := NEW.total_cost_per_case;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_line_calc_trigger ON quote_costing_lines;
CREATE TRIGGER quote_line_calc_trigger
  BEFORE INSERT OR UPDATE ON quote_costing_lines
  FOR EACH ROW EXECUTE FUNCTION calculate_quote_line_totals();
