'use client'
import { useEffect } from 'react'
import JsBarcode from 'jsbarcode'

interface Product {
  sku: string
  product_name: string
  upc_gtin: string | null
  product_location: string | null
  case_qty: number | null
}

interface Props {
  product: Product
  onClose: () => void
}

export default function CaseLabel({ product, onClose }: Props) {
  const barcodeValue = product.upc_gtin || product.sku

  useEffect(() => {
    try {
      JsBarcode('#barcode', barcodeValue, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 12,
        margin: 8,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch {
      // non-fatal
    }
  }, [barcodeValue])

  return (
    <>
      {/* Inline print CSS — hides everything except the label wrapper */}
      <style>{`
        @media print {
          body > *:not(#print-label-wrapper) { display: none !important; }
          #print-label-wrapper {
            display: block !important;
            position: fixed !important;
            top: 0; left: 0;
            width: 4in; height: 6in;
            margin: 0; padding: 0;
          }
        }
      `}</style>

      {/* Modal overlay */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-w-lg w-full"
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <div>
              <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Case Label</p>
              <h3 className="text-white font-semibold mt-0.5">{product.sku}</h3>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Label preview */}
          <div className="p-6" id="print-label-wrapper">
            <div id="print-label" style={{
              width: '4in',
              minHeight: '6in',
              background: 'white',
              color: 'black',
              fontFamily: "'Courier New', Courier, monospace",
              padding: '0.3in',
              border: '2px solid #333',
              margin: '0 auto',
              boxSizing: 'border-box',
            }}>
              {/* Company */}
              <div style={{ textAlign: 'center', paddingBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '13px', letterSpacing: '0.3px' }}>
                  beyondGREEN biotech, Inc.
                </div>
                <div style={{ fontSize: '9px', marginTop: '2px', color: '#444' }}>
                  1202 E. Wakeham Ave., Santa Ana, CA 92705
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '2px solid #333', margin: '8px 0' }}/>

              {/* Part info */}
              <div style={{ fontSize: '12px', lineHeight: '1.7' }}>
                <div><span style={{ fontWeight: 'bold' }}>MFG Part#:</span>&nbsp;{product.sku}</div>
                <div><span style={{ fontWeight: 'bold' }}>GTIN/UPC:</span>&nbsp;{product.upc_gtin ?? product.sku}</div>
              </div>

              <hr style={{ border: 'none', borderTop: '2px solid #333', margin: '8px 0' }}/>

              {/* Barcode */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                <svg id="barcode"/>
              </div>

              <hr style={{ border: 'none', borderTop: '2px solid #333', margin: '8px 0' }}/>

              {/* Product name */}
              <div style={{ fontSize: '10px', fontWeight: 'bold', textAlign: 'center', margin: '6px 0', lineHeight: '1.4' }}>
                {product.product_name}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid #ccc', margin: '8px 0' }}/>

              {/* Location + Case Qty */}
              <div style={{ fontSize: '12px', lineHeight: '1.7' }}>
                <div><span style={{ fontWeight: 'bold' }}>Location:</span>&nbsp;{product.product_location ?? '—'}</div>
                <div><span style={{ fontWeight: 'bold' }}>Case Qty:</span>&nbsp;{product.case_qty ?? '—'}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 px-6 pb-5">
            <button onClick={onClose}
              className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">
              Close
            </button>
            <button onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              Print
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
