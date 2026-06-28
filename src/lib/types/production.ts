/**
 * Production Reports Types
  * Defines TypeScript interfaces for production reporting system
   */

   export interface ProductionReport {
     id: string
       type: 'walmart' | 'chewy' | 'amazon' | 'direct'
         date: string // ISO date
           week_number: number
             month_number: number
               year_number: number
                 status: 'Draft' | 'Submitted' | 'Completed' | 'Archived'
                   data: Record<string, any> // Flexible storage for report metadata
                     summary_data: ReportCalculations
                       created_by: string // UUID
                         created_at: string
                           updated_at: string
                             submitted_at: string | null
                               completed_at: string | null
                               }

                               export interface ReportLineItem {
                                 id: string
                                   report_id: string
                                     sku: string
                                       order_qty: number
                                         pieces_per_unit: number
                                           total_pieces: number // Computed: order_qty * pieces_per_unit

                                             // Material requirements (two materials tracked)
                                               mat1_requirement: number
                                                 mat1_on_hand: number
                                                   mat1_delta: number // Computed: on_hand - requirement (NEGATIVE = shortage)

                                                     mat2_requirement: number
                                                       mat2_on_hand: number
                                                         mat2_delta: number

                                                           total_material: number // Computed: mat1 + mat2 requirements

                                                             // Packaging requirements
                                                               unit_packaging_required: number
                                                                 unit_packaging_on_hand: number
                                                                   unit_packaging_delta: number

                                                                     srp_packaging_required: number
                                                                       srp_packaging_on_hand: number
                                                                         srp_packaging_delta: number

                                                                           // Metadata
                                                                             is_manual_adjustment: boolean
                                                                               manual_fields?: string[] // Which fields were manually adjusted
                                                                                 notes?: string
                                                                                   sales_order_line_id?: string | null

                                                                                     // Timestamps
                                                                                       created_at: string
                                                                                         updated_at: string
                                                                                         }

                                                                                         export interface ReportCalculations {
                                                                                           total_order_qty: number
                                                                                             total_pieces_required: number

                                                                                               material_requirements: {
                                                                                                   mat1_total: number
                                                                                                       mat1_on_hand: number
                                                                                                           mat1_delta: number
                                                                                                               mat1_shortage: boolean
                                                                                                               
                                                                                                                   mat2_total: number
                                                                                                                       mat2_on_hand: number
                                                                                                                           mat2_delta: number
                                                                                                                               mat2_shortage: boolean
                                                                                                                                 }
                                                                                                                                 
                                                                                                                                   packaging_requirements: {
                                                                                                                                       unit_packaging_total: number
                                                                                                                                           unit_packaging_on_hand: number
                                                                                                                                               unit_packaging_delta: number
                                                                                                                                                   unit_packaging_shortage: boolean
                                                                                                                                                   
                                                                                                                                                       srp_packaging_total: number
                                                                                                                                                           srp_packaging_on_hand: number
                                                                                                                                                               srp_packaging_delta: number
                                                                                                                                                                   srp_packaging_shortage: boolean
                                                                                                                                                                     }
                                                                                                                                                                     
                                                                                                                                                                       days_to_complete: number
                                                                                                                                                                         critical_shortages: string[] // SKUs with negative deltas
                                                                                                                                                                         }
                                                                                                                                                                         
                                                                                                                                                                         export interface ReportMetadata {
                                                                                                                                                                           report_id: string
                                                                                                                                                                             line_item_count: number
                                                                                                                                                                               last_updated: string
                                                                                                                                                                                 last_updated_by: string
                                                                                                                                                                                   has_manual_adjustments: boolean
                                                                                                                                                                                     submission_ready: boolean // All required fields filled
                                                                                                                                                                                     }
                                                                                                                                                                                     
                                                                                                                                                                                     export interface ProductBOM {
                                                                                                                                                                                       sku: string // Finished good
                                                                                                                                                                                         component_sku: string
                                                                                                                                                                                           percentage: number // Composition ratio (0-100)
                                                                                                                                                                                           }
                                                                                                                                                                                           
                                                                                                                                                                                           export interface Product {
                                                                                                                                                                                             id?: string
                                                                                                                                                                                               sku: string
                                                                                                                                                                                                 product_name: string
                                                                                                                                                                                                   on_hand_qty: number
                                                                                                                                                                                                     reorder_point?: number
                                                                                                                                                                                                       requires_bom?: boolean
                                                                                                                                                                                                         weight_per_unit_grams?: number
                                                                                                                                                                                                           distribution_price?: number
                                                                                                                                                                                                             wholesale_price?: number
                                                                                                                                                                                                               msrp?: number
                                                                                                                                                                                                               }
