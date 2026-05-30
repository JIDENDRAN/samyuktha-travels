import os
import sys
from PIL import Image

# Reconfigure stdout to use UTF-8 to prevent Windows terminal encoding crashes
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def optimize_images(directory):
    total_original_size = 0
    total_optimized_size = 0
    optimized_count = 0
    
    print(f"[START] Starting Image Optimization in directory: {directory}")
    print("=" * 60)
    
    for root, dirs, files in os.walk(directory):
        # Skip node_modules or system dirs just in case
        if "node_modules" in root or ".git" in root:
            continue
            
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext not in ['.jpg', '.jpeg', '.png']:
                continue
                
            file_path = os.path.join(root, file)
            original_size = os.path.getsize(file_path)
            total_original_size += original_size
            
            try:
                with Image.open(file_path) as img:
                    width, height = img.size
                    max_dimension = 1920 if ext in ['.jpg', '.jpeg'] else 1200
                    
                    # 1. Resize if image is too large
                    if width > max_dimension or height > max_dimension:
                        if width > height:
                            new_width = max_dimension
                            new_height = int((height * max_dimension) / width)
                        else:
                            new_height = max_dimension
                            new_width = int((width * max_dimension) / height)
                        
                        print(f"[RESIZE] {file} from {width}x{height} to {new_width}x{new_height}")
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    
                    # 2. Compress and save in-place
                    if ext in ['.jpg', '.jpeg']:
                        # Convert RGBA to RGB for JPEG format compatibility
                        if img.mode in ('RGBA', 'LA', 'P'):
                            img = img.convert('RGB')
                        img.save(file_path, 'JPEG', quality=75, optimize=True)
                    elif ext == '.png':
                        # Keep alpha channel/transparency
                        if img.mode == 'RGBA':
                            # Optimize RGBA PNG
                            img.save(file_path, 'PNG', optimize=True)
                        else:
                            # Optimize RGB or Palette PNG
                            img.save(file_path, 'PNG', optimize=True)
                            
                optimized_size = os.path.getsize(file_path)
                total_optimized_size += optimized_size
                optimized_count += 1
                
                reduction = (original_size - optimized_size) / original_size * 100
                print(f"[OK] Optimized: {os.path.relpath(file_path, directory)}")
                print(f"   Original: {original_size / 1024 / 1024:.2f} MB | Optimized: {optimized_size / 1024 / 1024:.2f} MB | Reduction: {reduction:.1f}%")
                print("-" * 50)
                
            except Exception as e:
                print(f"[ERROR] Error optimizing {file}: {e}")
                total_optimized_size += original_size
                
    print("=" * 60)
    print("[SUCCESS] Optimization Complete!")
    print(f"Total files optimized: {optimized_count}")
    print(f"Total Original Size: {total_original_size / 1024 / 1024:.2f} MB")
    print(f"Total Optimized Size: {total_optimized_size / 1024 / 1024:.2f} MB")
    if total_original_size > 0:
        overall_reduction = (total_original_size - total_optimized_size) / total_original_size * 100
        print(f"Overall Space Saved: {overall_reduction:.1f}%")

if __name__ == "__main__":
    target_dir = os.path.abspath("static/images")
    if not os.path.exists(target_dir):
        print(f"Error: Target directory {target_dir} does not exist.")
        sys.exit(1)
    optimize_images(target_dir)
