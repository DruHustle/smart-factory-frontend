"""Read actual screenshot pixels rather than trusting QR DOM metadata."""
import sys
from PIL import Image
import zxingcpp

with Image.open(sys.argv[1]) as image:
    result = zxingcpp.read_barcode(image, formats=zxingcpp.BarcodeFormat.QRCode)
if result is None:
    raise SystemExit("The rendered passport QR code could not be decoded")
print(result.text)
