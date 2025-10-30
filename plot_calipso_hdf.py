#!/usr/bin/env python3
"""
Plot CALIPSO HDF4 file variables as 2D heatmaps.

This script reads CALIPSO Level 1 HDF files and creates curtain plots
(altitude vs along-track distance) for specified variables.

Usage:
    python plot_calipso_hdf.py <hdf_file> --variable <variable_name> [options]
    python plot_calipso_hdf.py <hdf_file> --list  # List available variables
"""

from pyhdf.SD import SD, SDC
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as colors
from pathlib import Path
import argparse
import sys


def list_hdf_variables(hdf_path):
    """
    List all available variables in HDF file.

    Args:
        hdf_path: Path to HDF file
    """
    print(f"\nAvailable variables in {Path(hdf_path).name}:\n")

    hdf = SD(str(hdf_path), SDC.READ)

    try:
        datasets = hdf.datasets()

        # Sort by name for easier reading
        sorted_datasets = sorted(datasets.items())

        print(f"{'Variable Name':<50} {'Shape':<20} {'Type'}")
        print("-" * 80)

        for name, info in sorted_datasets:
            dims = info[0]
            dtype = info[1]
            shape_str = f"({', '.join(map(str, dims))})"
            dtype_str = f"{dtype}"
            print(f"{name:<50} {shape_str:<20} {dtype_str}")

        print(f"\nTotal: {len(datasets)} variables")

        # Suggest common variables for plotting
        print("\nCommon variables for visualization:")
        common_vars = [
            'Total_Attenuated_Backscatter_532',
            'Attenuated_Backscatter_1064',
            'Perpendicular_Attenuated_Backscatter_532',
        ]

        for var in common_vars:
            if var in datasets:
                print(f"  - {var}")

    finally:
        hdf.end()


def get_calipso_altitudes(n_bins=583):
    """
    Generate standard CALIPSO Level 1 altitude array.

    Args:
        n_bins: Number of altitude bins

    Returns:
        1D numpy array of altitudes in km
    """
    # CALIPSO standard altitude range from -0.5 to 40 km
    altitudes = np.linspace(-0.5, 40, n_bins)
    return altitudes


def read_hdf_variable(hdf_path, variable_name):
    """
    Read a specific variable from CALIPSO HDF file.

    Args:
        hdf_path: Path to HDF file
        variable_name: Name of variable to read

    Returns:
        Dictionary with data, shape info, and metadata
    """
    hdf = SD(str(hdf_path), SDC.READ)

    try:
        # Check if variable exists
        datasets = hdf.datasets()
        if variable_name not in datasets:
            available = ', '.join(sorted(datasets.keys())[:10])
            raise ValueError(
                f"Variable '{variable_name}' not found in HDF file.\n"
                f"Available variables include: {available}...\n"
                f"Use --list to see all variables."
            )

        # Read the variable
        var_ds = hdf.select(variable_name)
        data = var_ds.get()

        # Get attributes if available
        attrs = var_ds.attributes()

        # Try to get units and description
        units = attrs.get('units', attrs.get('Units', 'N/A'))
        description = attrs.get('description', attrs.get('Description', ''))

        print(f"\nVariable: {variable_name}")
        print(f"Shape: {data.shape}")
        print(f"Data type: {data.dtype}")
        print(f"Units: {units}")
        if description:
            print(f"Description: {description}")
        print(f"Value range: {data.min():.6f} to {data.max():.6f}")

        # Get latitude and longitude for spatial context
        lat_ds = hdf.select('Latitude')
        lon_ds = hdf.select('Longitude')
        lat = lat_ds.get().flatten()
        lon = lon_ds.get().flatten()

        result = {
            'data': data,
            'units': units,
            'description': description,
            'lat': lat,
            'lon': lon,
            'variable_name': variable_name
        }

        return result

    finally:
        hdf.end()


def plot_2d_heatmap(data_dict, output_path=None, vmin=None, vmax=None,
                    cmap='viridis', log_scale=False, dpi=150):
    """
    Create 2D heatmap (curtain plot) of CALIPSO data.

    Args:
        data_dict: Dictionary from read_hdf_variable
        output_path: Path to save plot (if None, display instead)
        vmin: Minimum value for colorbar
        vmax: Maximum value for colorbar
        cmap: Matplotlib colormap name
        log_scale: Use logarithmic color scale
        dpi: Resolution for saved figure
    """
    data = data_dict['data']
    variable_name = data_dict['variable_name']
    units = data_dict['units']
    lat = data_dict['lat']
    lon = data_dict['lon']

    # Handle 2D data (profiles x altitudes)
    if len(data.shape) == 2:
        n_profiles, n_altitudes = data.shape
        altitudes = get_calipso_altitudes(n_altitudes)

        # Create profile indices for x-axis
        profile_indices = np.arange(n_profiles)

        # Mask invalid data (CALIPSO uses -9999 for fill values)
        data_masked = np.ma.masked_where((data < -100) | ~np.isfinite(data), data)

        # Create figure
        fig, ax = plt.subplots(figsize=(14, 6))

        # Determine color scale
        if vmin is None or vmax is None:
            valid_data = data_masked.compressed()
            if len(valid_data) > 0:
                if vmin is None:
                    vmin = np.percentile(valid_data, 1)
                if vmax is None:
                    vmax = np.percentile(valid_data, 99)

        # Create the plot
        if log_scale and vmin > 0:
            # Use logarithmic scale
            norm = colors.LogNorm(vmin=vmin, vmax=vmax)
            im = ax.pcolormesh(profile_indices, altitudes, data_masked.T,
                              cmap=cmap, norm=norm, shading='auto')
        else:
            # Use linear scale
            im = ax.pcolormesh(profile_indices, altitudes, data_masked.T,
                              cmap=cmap, vmin=vmin, vmax=vmax, shading='auto')

        # Add colorbar
        cbar = plt.colorbar(im, ax=ax, pad=0.02)
        if units != 'N/A':
            cbar.set_label(f"{variable_name}\n({units})", fontsize=10)
        else:
            cbar.set_label(variable_name, fontsize=10)

        # Labels and title
        ax.set_xlabel('Profile Index (along-track)', fontsize=11)
        ax.set_ylabel('Altitude (km)', fontsize=11)

        # Create title with spatial extent
        lat_range = f"{lat.min():.2f}° to {lat.max():.2f}°"
        lon_range = f"{lon.min():.2f}° to {lon.max():.2f}°"
        title = f"CALIPSO {variable_name}\n"
        title += f"Lat: {lat_range}, Lon: {lon_range}"
        ax.set_title(title, fontsize=12, pad=10)

        # Set altitude limits
        ax.set_ylim(-0.5, 20)  # Focus on troposphere/lower stratosphere

        # Grid
        ax.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)

        # Tight layout
        plt.tight_layout()

    elif len(data.shape) == 1:
        # 1D data (profile-level only)
        print("\nNote: This is 1D profile-level data, plotting as line graph.")

        fig, ax = plt.subplots(figsize=(12, 4))
        profile_indices = np.arange(len(data))

        ax.plot(profile_indices, data, linewidth=1)
        ax.set_xlabel('Profile Index (along-track)', fontsize=11)
        ax.set_ylabel(f"{variable_name}" + (f" ({units})" if units != 'N/A' else ""), fontsize=11)

        lat_range = f"{lat.min():.2f}° to {lat.max():.2f}°"
        lon_range = f"{lon.min():.2f}° to {lon.max():.2f}°"
        title = f"CALIPSO {variable_name}\n"
        title += f"Lat: {lat_range}, Lon: {lon_range}"
        ax.set_title(title, fontsize=12)

        ax.grid(True, alpha=0.3)
        plt.tight_layout()

    else:
        raise ValueError(f"Cannot plot data with shape {data.shape}. Expected 1D or 2D array.")

    # Save or show
    if output_path:
        plt.savefig(output_path, dpi=dpi, bbox_inches='tight')
        print(f"\nPlot saved to: {output_path}")
    else:
        plt.show()

    plt.close()


def main():
    parser = argparse.ArgumentParser(
        description='Plot CALIPSO HDF4 file variables as 2D heatmaps',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all variables in file
  python plot_calipso_hdf.py data.hdf --list

  # Plot 532nm backscatter
  python plot_calipso_hdf.py data.hdf --variable Total_Attenuated_Backscatter_532

  # Plot with custom color range and save to file
  python plot_calipso_hdf.py data.hdf --variable Total_Attenuated_Backscatter_532 \\
      --vmin -0.001 --vmax 0.01 --output plot.png --log-scale

  # Use different colormap
  python plot_calipso_hdf.py data.hdf --variable Attenuated_Backscatter_1064 \\
      --cmap jet --output 1064nm.png
        """
    )

    parser.add_argument('hdf_file', help='Path to CALIPSO HDF4 file')
    parser.add_argument('--list', '-l', action='store_true',
                       help='List all available variables and exit')
    parser.add_argument('--variable', '-v', type=str,
                       help='Variable name to plot')
    parser.add_argument('--output', '-o', type=str,
                       help='Output file path (PNG). If not specified, displays plot.')
    parser.add_argument('--vmin', type=float,
                       help='Minimum value for color scale (default: auto from 1st percentile)')
    parser.add_argument('--vmax', type=float,
                       help='Maximum value for color scale (default: auto from 99th percentile)')
    parser.add_argument('--cmap', type=str, default='viridis',
                       help='Matplotlib colormap name (default: viridis)')
    parser.add_argument('--log-scale', action='store_true',
                       help='Use logarithmic color scale')
    parser.add_argument('--dpi', type=int, default=150,
                       help='DPI for saved figure (default: 150)')

    args = parser.parse_args()

    # Check file exists
    hdf_path = Path(args.hdf_file)
    if not hdf_path.exists():
        print(f"Error: File not found: {hdf_path}", file=sys.stderr)
        sys.exit(1)

    # List variables if requested
    if args.list:
        list_hdf_variables(hdf_path)
        sys.exit(0)

    # Require variable name if not listing
    if not args.variable:
        print("Error: --variable is required (or use --list to see available variables)",
              file=sys.stderr)
        parser.print_help()
        sys.exit(1)

    try:
        # Read variable
        data_dict = read_hdf_variable(hdf_path, args.variable)

        # Create plot
        plot_2d_heatmap(
            data_dict,
            output_path=args.output,
            vmin=args.vmin,
            vmax=args.vmax,
            cmap=args.cmap,
            log_scale=args.log_scale,
            dpi=args.dpi
        )

        if not args.output:
            print("\nNote: Plot displayed. Use --output to save to file.")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
