# Create backgrounds folder
$folder = "public\images\backgrounds"
New-Item -ItemType Directory -Force -Path $folder

# Download images
Write-Host "Downloading background images..."

Invoke-WebRequest -Uri "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1920&q=80" -OutFile "$folder\landing.jpg"
Write-Host "Downloaded landing.jpg"

Invoke-WebRequest -Uri "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=80" -OutFile "$folder\login.jpg"
Write-Host "Downloaded login.jpg"

Invoke-WebRequest -Uri "https://images.unsplash.com/photo-1506617564039-2f3b650b7010?w=1920&q=80" -OutFile "$folder\user.jpg"
Write-Host "Downloaded user.jpg"

Invoke-WebRequest -Uri "https://images.unsplash.com/photo-1553413077-190dd305871c?w=1920&q=80" -OutFile "$folder\admin.jpg"
Write-Host "Downloaded admin.jpg"

Write-Host "`nAll images downloaded successfully!"
Write-Host "Location: $folder"
