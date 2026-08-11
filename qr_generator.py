import qrcode
from PIL import Image

def generate_qr(data: str, filename: str = "linkedin_qr.png", fill_color: str = "blue", back_color: str = "white", box_size: int = 10, border: int = 4):
    """
    Generates a QR code image with specified parameters and saves it to disk.
    
    :param data: The text or URL to encode inside the QR code.
    :param filename: Output filename (e.g. linkedin_qr.png).
    :param fill_color: Foreground color of the QR module squares (default: 'blue').
    :param back_color: Background color of the QR card (default: 'white').
    :param box_size: Size of each module square in pixels (default: 10).
    :param border: Width of the border around the QR code in modules (default: 4).
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=box_size,
        border=border,
    )

    qr.add_data(data)
    qr.make(fit=True)

    img = qr.make_image(fill_color=fill_color, back_color=back_color)
    img.save(filename)
    print(f"[Success] QR code generated successfully for '{data[:30]}...' -> saved as '{filename}'")
    return filename

if __name__ == "__main__":
    # Default LinkedIn URL from configuration
    linkedin_url = "https://www.linkedin.com/in/ayush-gautam-9baa14248?lipi=urn%3Ali%3Apage%3Ad_flagship3_profile_view_base_contact_details%3B4c5TkR0kTD%2BC0ij4DYeDXw%3D%3D"
    generate_qr(
        data=linkedin_url,
        filename="linkedin_qr.png",
        fill_color="blue",
        back_color="white"
    )
