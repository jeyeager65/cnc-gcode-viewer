/**
 * Camera Module
 * Handles camera transformations, orbit controls, and touch gestures
 */

class Camera {
    constructor() {
        this.position = { x: 0, y: 0, z: 100 };
        this.target = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0, w: 1 }; // Quaternion
        this.zoom = 1;
        this.orthoScale = 100;
        
        // For smooth interpolation
        this.targetPosition = { ...this.position };
        this.targetTarget = { ...this.target };
        this.targetRotation = { ...this.rotation };
        this.targetZoom = this.zoom;
        
        // 2D pan/zoom
        this.pan2d = { x: 0, y: 0 };
        this.zoom2d = 1;
        this.targetPan2d = { ...this.pan2d };
        this.targetZoom2d = this.zoom2d;
        
        // Initial zoom values for relative zoom display (100% = fit-to-bounds)
        this.initialZoom2d = 1;
        this.initialOrthoScale = 100;
    }

    /**
     * Fit camera to bounds
     */
    fitToBounds(bounds, padding = 0.1, canvasWidth = 800, canvasHeight = 600) {
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;
        
        this.target = { x: centerX, y: centerY, z: centerZ };
        this.targetTarget = { x: centerX, y: centerY, z: centerZ };
        
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const depth = bounds.maxZ - bounds.minZ;
        
        const maxDim = Math.max(width, height, depth) || 100;
        // Reduce orthoScale for tighter 3D view (was 1 + padding, now 0.6 + padding/2)
        this.orthoScale = maxDim * (0.6 + padding / 2);
        
        // Calculate 2D zoom to fit bounds in canvas
        // Use default dimensions if canvas is not visible/sized yet
        const safeCanvasWidth = canvasWidth > 0 ? canvasWidth : 800;
        const safeCanvasHeight = canvasHeight > 0 ? canvasHeight : 600;
        
        // Reduce padding for tighter fit - use smaller padding for 2D view
        const paddedWidth = Math.max(width * (1 + padding * 0.5), 1);
        const paddedHeight = Math.max(height * (1 + padding * 0.5), 1);
        
        const scaleX = safeCanvasWidth / paddedWidth;
        const scaleY = safeCanvasHeight / paddedHeight;
        const fitZoom = Math.min(scaleX, scaleY);
        
        console.log('Camera fitToBounds:', {
            bounds: { width, height },
            canvas: { width: safeCanvasWidth, height: safeCanvasHeight },
            center: { x: centerX, y: centerY },
            scales: { x: scaleX, y: scaleY, chosen: fitZoom }
        });
        
        // Reset 2D view centered and fitted
        this.pan2d = { x: centerX, y: centerY };
        this.zoom2d = fitZoom;
        this.targetPan2d = { ...this.pan2d };
        this.targetZoom2d = this.zoom2d;
        
        // Store initial zoom values for relative zoom display
        this.initialZoom2d = fitZoom;
        this.initialOrthoScale = this.orthoScale;
        
        // Reset 3D view - position camera above looking down (standard CNC view)
        // Rotated 90° CCW so Y axis points up on screen
        this.position = { x: centerX + maxDim * 2, y: centerY, z: centerZ };
        this.targetPosition = { x: centerX, y: centerY, z: centerZ + maxDim * 2 };
        this.rotation = { x: 0, y: 0, z: 0, w: 1 };
        this.targetRotation = { x: 0, y: 0, z: 0, w: 1 };
    }

    /**
     * Update camera with smooth interpolation
     */
    update(deltaTime = 16) {
        const smoothness = 0.15;
        
        // Smooth 2D pan
        this.pan2d.x += (this.targetPan2d.x - this.pan2d.x) * smoothness;
        this.pan2d.y += (this.targetPan2d.y - this.pan2d.y) * smoothness;
        
        // Smooth 2D zoom
        this.zoom2d += (this.targetZoom2d - this.zoom2d) * smoothness;
        
        // Smooth 3D position
        this.position.x += (this.targetPosition.x - this.position.x) * smoothness;
        this.position.y += (this.targetPosition.y - this.position.y) * smoothness;
        this.position.z += (this.targetPosition.z - this.position.z) * smoothness;
        
        // Smooth 3D target
        this.target.x += (this.targetTarget.x - this.target.x) * smoothness;
        this.target.y += (this.targetTarget.y - this.target.y) * smoothness;
        this.target.z += (this.targetTarget.z - this.target.z) * smoothness;
        
        // Smooth 3D rotation (quaternion slerp)
        this.rotation = this.slerpQuaternion(this.rotation, this.targetRotation, smoothness);
        
        // Smooth zoom
        this.zoom += (this.targetZoom - this.zoom) * smoothness;
    }

    /**
     * Pan 2D view
     */
    pan2D(dx, dy) {
        this.targetPan2d.x -= dx / this.zoom2d;
        this.targetPan2d.y += dy / this.zoom2d; // + instead of - because Y is flipped in renderer
    }

    /**
     * Zoom 2D view
     * @param {number} delta - The zoom delta (wheel deltaY or pinch distance change)
     * @param {number} canvasX - Mouse/touch X position on canvas
     * @param {number} canvasY - Mouse/touch Y position on canvas
     * @param {number} canvasWidth - Canvas width
     * @param {number} canvasHeight - Canvas height
     * @param {boolean} isTouch - Whether this is from a touch gesture (uses different sensitivity)
     */
    zoom2D(delta, canvasX, canvasY, canvasWidth, canvasHeight, isTouch = false) {
        // Use different sensitivity for touch vs mouse wheel
        // Mouse wheel deltas are ~100-120 per tick, touch pinch deltas are ~1-10 pixels
        const zoomSpeed = isTouch ? 0.015 : 0.001;
        const zoomFactor = 1 - (delta * zoomSpeed);
        
        // Get current transform
        const transform = this.get2DTransform(canvasWidth, canvasHeight);
        
        // Convert canvas coordinates to world coordinates before zoom
        // Account for flipped Y-axis
        const worldX = (canvasX - transform.translateX) / transform.scale;
        const worldY = (canvasY - transform.translateY) / transform.scale; // Removed negation
        
        const oldZoom = this.targetZoom2d;
        this.targetZoom2d *= zoomFactor;
        // Limit to 10% - 1000% relative zoom (0.1x to 10x of initial fit-to-bounds)
        const minZoom = this.initialZoom2d * 0.1;
        const maxZoom = this.initialZoom2d * 10;
        this.targetZoom2d = Math.max(minZoom, Math.min(maxZoom, this.targetZoom2d));
        
        // Adjust pan to keep world coordinates under mouse the same
        const newTranslateX = canvasX - worldX * this.targetZoom2d;
        const newTranslateY = canvasY - worldY * this.targetZoom2d; // Changed + to -
        
        this.targetPan2d.x = (canvasWidth / 2 - newTranslateX) / this.targetZoom2d;
        this.targetPan2d.y = -(canvasHeight / 2 - newTranslateY) / this.targetZoom2d; // Added negation
    }

    /**
     * Rotate camera (orbit around target)
     */
    /**
     * Rotate camera (orbit around target)
     * Horizontal drag = rotate around camera's up vector
     * Vertical drag = rotate around camera's right vector
     */
    rotate(deltaX, deltaY) {
        const sensitivity = 0.01;
        
        // Get camera basis vectors
        const eye = this.position;
        const center = this.target;
        const worldUp = { x: 0, y: 1, z: 0 };
        
        // Forward vector (from camera to target)
        const forward = {
            x: center.x - eye.x,
            y: center.y - eye.y,
            z: center.z - eye.z
        };
        const fLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z);
        forward.x /= fLen;
        forward.y /= fLen;
        forward.z /= fLen;
        
        // Right vector
        const right = {
            x: worldUp.y * forward.z - worldUp.z * forward.y,
            y: worldUp.z * forward.x - worldUp.x * forward.z,
            z: worldUp.x * forward.y - worldUp.y * forward.x
        };
        const rLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
        right.x /= rLen;
        right.y /= rLen;
        right.z /= rLen;
        
        // True up vector
        const up = {
            x: forward.y * right.z - forward.z * right.y,
            y: forward.z * right.x - forward.x * right.z,
            z: forward.x * right.y - forward.y * right.x
        };
        
        // Get vector from target to camera
        const toCamera = {
            x: eye.x - center.x,
            y: eye.y - center.y,
            z: eye.z - center.z
        };
        
        // Rotate around up vector (horizontal drag)
        const yawAngle = -deltaX * sensitivity;
        const cosYaw = Math.cos(yawAngle);
        const sinYaw = Math.sin(yawAngle);
        
        let rotated = {
            x: toCamera.x * (cosYaw + up.x * up.x * (1 - cosYaw)) +
               toCamera.y * (up.x * up.y * (1 - cosYaw) - up.z * sinYaw) +
               toCamera.z * (up.x * up.z * (1 - cosYaw) + up.y * sinYaw),
            y: toCamera.x * (up.y * up.x * (1 - cosYaw) + up.z * sinYaw) +
               toCamera.y * (cosYaw + up.y * up.y * (1 - cosYaw)) +
               toCamera.z * (up.y * up.z * (1 - cosYaw) - up.x * sinYaw),
            z: toCamera.x * (up.z * up.x * (1 - cosYaw) - up.y * sinYaw) +
               toCamera.y * (up.z * up.y * (1 - cosYaw) + up.x * sinYaw) +
               toCamera.z * (cosYaw + up.z * up.z * (1 - cosYaw))
        };
        
        // Rotate around right vector (vertical drag)
        const pitchAngle = deltaY * sensitivity;
        const cosPitch = Math.cos(pitchAngle);
        const sinPitch = Math.sin(pitchAngle);
        
        const newPos = {
            x: rotated.x * (cosPitch + right.x * right.x * (1 - cosPitch)) +
               rotated.y * (right.x * right.y * (1 - cosPitch) - right.z * sinPitch) +
               rotated.z * (right.x * right.z * (1 - cosPitch) + right.y * sinPitch),
            y: rotated.x * (right.y * right.x * (1 - cosPitch) + right.z * sinPitch) +
               rotated.y * (cosPitch + right.y * right.y * (1 - cosPitch)) +
               rotated.z * (right.y * right.z * (1 - cosPitch) - right.x * sinPitch),
            z: rotated.x * (right.z * right.x * (1 - cosPitch) - right.y * sinPitch) +
               rotated.y * (right.z * right.y * (1 - cosPitch) + right.x * sinPitch) +
               rotated.z * (cosPitch + right.z * right.z * (1 - cosPitch))
        };
        
        // Calculate the pitch angle of the new position
        const newPosLen = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
        const newPosNorm = { x: newPos.x / newPosLen, y: newPos.y / newPosLen, z: newPos.z / newPosLen };
        const newPitch = Math.asin(-newPosNorm.y); // Negative because camera looks down at target
        
        // Clamp to prevent gimbal lock
        const maxPitch = Math.PI / 2 - 0.09; // ~85 degrees
        if (Math.abs(newPitch) > maxPitch) {
            // Don't apply this rotation, we're at the limit
            this.targetPosition.x = center.x + rotated.x;
            this.targetPosition.y = center.y + rotated.y;
            this.targetPosition.z = center.z + rotated.z;
        } else {
            // Update camera position relative to target
            this.targetPosition.x = center.x + newPos.x;
            this.targetPosition.y = center.y + newPos.y;
            this.targetPosition.z = center.z + newPos.z;
        }
    }

    /**
     * Pan 3D view
     */
    /**
     * Pan 3D view in camera's local axes (screen space)
     * dx, dy: mouse movement in pixels
     */
    pan3D(dx, dy) {
        const panSpeed = this.orthoScale * 0.002;
        // Calculate camera basis vectors
        const eye = this.position;
        const center = this.target;
        const up = { x: 0, y: 1, z: 0 };
        // Forward vector
        const forward = {
            x: center.x - eye.x,
            y: center.y - eye.y,
            z: center.z - eye.z
        };
        // Normalize forward
        const fLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z);
        forward.x /= fLen;
        forward.y /= fLen;
        forward.z /= fLen;
        // Right vector
        const right = {
            x: up.y * forward.z - up.z * forward.y,
            y: up.z * forward.x - up.x * forward.z,
            z: up.x * forward.y - up.y * forward.x
        };
        // Normalize right
        const rLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
        right.x /= rLen;
        right.y /= rLen;
        right.z /= rLen;
        // True up vector
        const trueUp = {
            x: forward.y * right.z - forward.z * right.y,
            y: forward.z * right.x - forward.x * right.z,
            z: forward.x * right.y - forward.y * right.x
        };
        // Normalize trueUp
        const uLen = Math.sqrt(trueUp.x * trueUp.x + trueUp.y * trueUp.y + trueUp.z * trueUp.z);
        trueUp.x /= uLen;
        trueUp.y /= uLen;
        trueUp.z /= uLen;
        // Move camera and target along right/up vectors
        this.targetPosition.x += (dx * panSpeed) * right.x + (dy * panSpeed) * trueUp.x;
        this.targetPosition.y += (dx * panSpeed) * right.y + (dy * panSpeed) * trueUp.y;
        this.targetPosition.z += (dx * panSpeed) * right.z + (dy * panSpeed) * trueUp.z;
        this.targetTarget.x += (dx * panSpeed) * right.x + (dy * panSpeed) * trueUp.x;
        this.targetTarget.y += (dx * panSpeed) * right.y + (dy * panSpeed) * trueUp.y;
        this.targetTarget.z += (dx * panSpeed) * right.z + (dy * panSpeed) * trueUp.z;
    }

    /**
     * Zoom 3D view
     */
    zoom3D(delta) {
        // Reduce sensitivity for mouse wheel (delta is typically 100)
        // For 3D mouse, delta is much smaller (< 1)
        const wheelSensitivity = Math.abs(delta) > 10 ? 0.001 : 1.0;
        const adjustedDelta = delta * wheelSensitivity;
        
        // Use delta directly for smooth continuous zoom
        // Positive delta = zoom in (increase scale), negative = zoom out (decrease scale)
        this.orthoScale *= (1 + adjustedDelta);
        // Limit to 10% - 1000% relative zoom (smaller orthoScale = more zoomed in)
        const minScale = this.initialOrthoScale * 0.1;  // 1000% zoom (10x closer)
        const maxScale = this.initialOrthoScale * 10;   // 10% zoom (10x farther)
        this.orthoScale = Math.max(minScale, Math.min(maxScale, this.orthoScale));
    }

    /**
     * Get 2D transformation for canvas
     */
    get2DTransform(canvasWidth, canvasHeight) {
        return {
            translateX: canvasWidth / 2 - this.pan2d.x * this.zoom2d,
            translateY: canvasHeight / 2 + this.pan2d.y * this.zoom2d, // + instead of - because Y is flipped in renderer
            scale: this.zoom2d
        };
    }

    /**
     * Get orthographic projection matrix for 3D
     */
    getProjectionMatrix(aspect) {
        const scale = this.orthoScale;
        const left = -scale * aspect;
        const right = scale * aspect;
        const bottom = -scale;
        const top = scale;
        const near = -10000;
        const far = 10000;
        
        const rl = right - left;
        const tb = top - bottom;
        const fn = far - near;
        
        return [
            2 / rl, 0, 0, 0,
            0, 2 / tb, 0, 0,
            0, 0, -2 / fn, 0,
            -(right + left) / rl, -(top + bottom) / tb, -(far + near) / fn, 1
        ];
    }

    /**
     * Get view matrix for 3D
     */
    getViewMatrix() {
        // Simple lookAt matrix
        // Camera is at position, looking at target, with up = [0, 1, 0] (Y-up on screen for top-down view)
        
        const eye = this.position;
        const center = this.target;
        const up = { x: 0, y: 1, z: 0 };
        
        // Calculate camera basis vectors
        const zAxis = {
            x: eye.x - center.x,
            y: eye.y - center.y,
            z: eye.z - center.z
        };
        const zLen = Math.sqrt(zAxis.x * zAxis.x + zAxis.y * zAxis.y + zAxis.z * zAxis.z);
        zAxis.x /= zLen;
        zAxis.y /= zLen;
        zAxis.z /= zLen;
        
        const xAxis = {
            x: up.y * zAxis.z - up.z * zAxis.y,
            y: up.z * zAxis.x - up.x * zAxis.z,
            z: up.x * zAxis.y - up.y * zAxis.x
        };
        const xLen = Math.sqrt(xAxis.x * xAxis.x + xAxis.y * xAxis.y + xAxis.z * xAxis.z);
        xAxis.x /= xLen;
        xAxis.y /= xLen;
        xAxis.z /= xLen;
        
        const yAxis = {
            x: zAxis.y * xAxis.z - zAxis.z * xAxis.y,
            y: zAxis.z * xAxis.x - zAxis.x * xAxis.z,
            z: zAxis.x * xAxis.y - zAxis.y * xAxis.x
        };
        
        // View matrix (column-major for WebGL)
        return [
            xAxis.x, yAxis.x, zAxis.x, 0,
            xAxis.y, yAxis.y, zAxis.y, 0,
            xAxis.z, yAxis.z, zAxis.z, 0,
            -(xAxis.x * eye.x + xAxis.y * eye.y + xAxis.z * eye.z),
            -(yAxis.x * eye.x + yAxis.y * eye.y + yAxis.z * eye.z),
            -(zAxis.x * eye.x + zAxis.y * eye.y + zAxis.z * eye.z),
            1
        ];
    }

    /**
     * Convert axis-angle to quaternion
     */
    axisAngleToQuaternion(axis, angle) {
        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);
        return {
            x: axis.x * s,
            y: axis.y * s,
            z: axis.z * s,
            w: Math.cos(halfAngle)
        };
    }

    /**
     * Multiply two quaternions
     */
    multiplyQuaternion(a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
        };
    }

    /**
     * Normalize quaternion
     */
    normalizeQuaternion(q) {
        const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
        return {
            x: q.x / len,
            y: q.y / len,
            z: q.z / len,
            w: q.w / len
        };
    }

    /**
     * Spherical linear interpolation for quaternions
     */
    slerpQuaternion(a, b, t) {
        let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        
        // Ensure shortest path
        if (dot < 0) {
            b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
            dot = -dot;
        }
        
        // If quaternions are very close, use linear interpolation
        if (dot > 0.9995) {
            return this.normalizeQuaternion({
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y),
                z: a.z + t * (b.z - a.z),
                w: a.w + t * (b.w - a.w)
            });
        }
        
        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);
        const wa = Math.sin((1 - t) * theta) / sinTheta;
        const wb = Math.sin(t * theta) / sinTheta;
        
        return {
            x: a.x * wa + b.x * wb,
            y: a.y * wa + b.y * wb,
            z: a.z * wa + b.z * wb,
            w: a.w * wa + b.w * wb
        };
    }

    /**
     * Convert quaternion to 4x4 matrix
     */
    quaternionToMatrix(q) {
        const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
        const xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
        const wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
        
        return [
            1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0,
            2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0,
            2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0,
            0, 0, 0, 1
        ];
    }

    /**
     * Multiply two 4x4 matrices (column-major)
     */
    multiplyMatrices(a, b) {
        const result = new Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                result[col * 4 + row] = 
                    a[0 * 4 + row] * b[col * 4 + 0] +
                    a[1 * 4 + row] * b[col * 4 + 1] +
                    a[2 * 4 + row] * b[col * 4 + 2] +
                    a[3 * 4 + row] * b[col * 4 + 3];
            }
        }
        return result;
    }

    /**
     * Get combined MVP matrix
     */
    getMVPMatrix(aspect) {
        const projection = this.getProjectionMatrix(aspect);
        const view = this.getViewMatrix();
        return this.multiplyMatrices(projection, view);
    }
}
